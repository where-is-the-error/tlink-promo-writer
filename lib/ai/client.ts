import { ApiError as GeminiApiError, GoogleGenAI, type Part } from "@google/genai";
import { z } from "zod";
import { db, env } from "../db";
import { ApiError } from "../http";

/**
 * 역할별 모델. 환경 변수로 바꿀 수 있다.
 * - pro: 카드 생성·원문 대조(가장 정확해야 하는 호출)
 * - flash: 사진 분류·글 쓰기
 * - lite: 지시문 판별·도입부 유형 분류
 */
export const MODELS = {
  get pro() {
    return process.env.GEMINI_MODEL_PRO || "gemini-3.8-flash";
  },
  get flash() {
    return process.env.GEMINI_MODEL_FLASH || "gemini-3.8-flash";
  },
  get lite() {
    return process.env.GEMINI_MODEL_LITE || "gemini-3.5-flash-lite";
  },
};

export type { Part };

let client: GoogleGenAI | null = null;
export function genai(): GoogleGenAI {
  client ??= new GoogleGenAI({ apiKey: env("GEMINI_API_KEY") });
  return client;
}

interface Usage {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  thoughtsTokenCount?: number;
  cachedContentTokenCount?: number;
}

/**
 * 100만 토큰당 달러 단가는 환경 변수로 넣는다(모델·요금제마다 달라 코드에 박아 두지 않는다).
 * 단가를 넣지 않으면 비용은 0으로 기록되고 글 1건 비용 상한도 걸리지 않는다. 토큰 수는 항상 기록된다.
 */
export function costUsd(usage: Usage): number {
  const input = Number(process.env.GEMINI_PRICE_INPUT_PER_MTOK ?? "0");
  const output = Number(process.env.GEMINI_PRICE_OUTPUT_PER_MTOK ?? "0");
  const out = (usage.candidatesTokenCount ?? 0) + (usage.thoughtsTokenCount ?? 0);
  return ((usage.promptTokenCount ?? 0) * input + out * output) / 1_000_000;
}

/** 글 1건의 AI 비용이 상한(COST_CAP_PER_POST_USD)에 닿으면 추가 호출을 막는다. */
export async function assertBudget(postId: string): Promise<void> {
  const cap = Number(process.env.COST_CAP_PER_POST_USD ?? "1");
  const { data } = await db().from("ai_calls").select("cost_usd").eq("post_id", postId);
  const spent = (data ?? []).reduce((sum, r) => sum + Number(r.cost_usd), 0);
  if (spent >= cap) {
    throw new ApiError(
      429,
      "cost_cap_reached",
      `이 글의 AI 비용이 상한 $${cap.toFixed(2)}에 도달해 추가 호출을 막았습니다. (사용 $${spent.toFixed(2)})`,
    );
  }
}

interface CallOptions<S extends z.ZodType> {
  purpose: string;
  model: string;
  system: string;
  parts: Part[];
  schema: S;
  postId?: string;
  maxTokens?: number;
}

/** zod 스키마 → 응답용 JSON 스키마. `$schema`와 정수의 안전 범위 한계값처럼 불필요한 키는 뺀다. */
export function jsonSchema(schema: z.ZodType): unknown {
  const strip = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(strip);
    if (!node || typeof node !== "object") return node;
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node)) {
      if (key === "$schema") continue;
      if ((key === "minimum" || key === "maximum") && Math.abs(Number(value)) >= Number.MAX_SAFE_INTEGER) continue;
      out[key] = strip(value);
    }
    return out;
  };
  return strip(z.toJSONSchema(schema));
}

/**
 * 모든 Gemini 호출이 지나는 한 곳.
 * - tools 없음(권한 최소화). 출력은 JSON 스키마로 고정한 구조화 출력만 쓴다.
 * - 스트리밍으로 받아 이어 붙인다(긴 응답의 타임아웃 방지).
 * - 차단·잘림(finishReason)을 먼저 확인하고, 호출마다 ai_calls 로그를 남긴다.
 */
export async function callModel<S extends z.ZodType>(o: CallOptions<S>): Promise<z.infer<S>> {
  if (o.postId) await assertBudget(o.postId);
  const started = Date.now();

  let text = "";
  let usage: Usage = {};
  let finish: string | undefined;
  let blocked: string | undefined;
  try {
    const stream = await genai().models.generateContentStream({
      model: o.model,
      contents: [{ role: "user", parts: o.parts }],
      config: {
        systemInstruction: o.system,
        responseMimeType: "application/json",
        responseJsonSchema: jsonSchema(o.schema),
        maxOutputTokens: o.maxTokens ?? 32000,
      },
    });
    for await (const chunk of stream) {
      text += chunk.text ?? "";
      usage = chunk.usageMetadata ?? usage;
      finish = chunk.candidates?.[0]?.finishReason ?? finish;
      blocked = chunk.promptFeedback?.blockReason ?? blocked;
    }
  } catch (e) {
    if (e instanceof GeminiApiError) {
      if (e.status === 429) throw new ApiError(429, "ai_rate_limited", "AI 요청이 많아 잠시 후 다시 시도해야 합니다.");
      throw new ApiError(502, "ai_error", `AI 호출 실패(${e.status}): ${e.message}`);
    }
    if (e instanceof ApiError) throw e;
    throw new ApiError(503, "ai_unreachable", "AI 서버에 연결하지 못했습니다.");
  }

  await db()
    .from("ai_calls")
    .insert({
      post_id: o.postId ?? null,
      purpose: o.purpose,
      model: o.model,
      input_tokens: usage.promptTokenCount ?? 0,
      output_tokens: (usage.candidatesTokenCount ?? 0) + (usage.thoughtsTokenCount ?? 0),
      cache_read_tokens: usage.cachedContentTokenCount ?? 0,
      cost_usd: costUsd(usage),
      duration_ms: Date.now() - started,
    });

  if (blocked || (finish && !["STOP", "MAX_TOKENS"].includes(finish))) {
    throw new ApiError(502, "ai_refusal", "AI가 이 요청을 처리하지 않았습니다. 입력을 확인해 주세요.");
  }
  if (finish === "MAX_TOKENS") throw new ApiError(502, "ai_truncated", "AI 응답이 길이 제한으로 잘렸습니다.");

  try {
    return o.schema.parse(JSON.parse(text));
  } catch {
    throw new ApiError(502, "ai_bad_output", "AI 응답이 정해진 형식이 아닙니다.");
  }
}
