import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";
import { db } from "../db";
import { ApiError } from "../http";

export const MODELS = {
  opus: "claude-opus-5-5",
  sonnet: "claude-sonnet-5-5",
  haiku: "claude-haiku-5-5",
} as const;
export type Model = (typeof MODELS)[keyof typeof MODELS];
export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

/** 100만 토큰당 달러. 캐시 읽기는 모델별 고정가, 캐시 쓰기는 입력가의 1.25배. */
const PRICES: Record<string, { input: number; output: number; cacheRead: number }> = {
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2 },
  "claude-opus-5": { input: 5, output: 25, cacheRead: 0.5 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.1 },
  "claude-sonnet-5": { input: 2, output: 10, cacheRead: 0.2 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01 },
};

let client: Anthropic | null = null;
function anthropic(): Anthropic {
  client ??= new Anthropic();
  return client;
}

export function costUsd(model: string, usage: Anthropic.Beta.BetaUsage): number {
  const p = PRICES[model] ?? PRICES[MODELS.opus];
  const cacheWrite = usage.cache_creation_input_tokens ?? 0;
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  return (
    (usage.input_tokens * p.input +
      cacheWrite * p.input * 1.25 +
      cacheRead * p.cacheRead +
      usage.output_tokens * p.output) /
    1_000_000
  );
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

interface CallOptions<S extends z.ZodType | undefined> {
  purpose: string;
  model: Model;
  effort: Effort;
  system: string;
  content: Anthropic.Beta.BetaContentBlockParam[];
  schema?: S;
  postId?: string;
  maxTokens?: number;
}

interface CallResult<S extends z.ZodType | undefined> {
  message: Anthropic.Beta.BetaMessage;
  parsed: S extends z.ZodType ? z.infer<S> : undefined;
}

/**
 * 모든 Claude 호출이 지나는 한 곳.
 * - tools 없음(권한 최소화). JSON이 필요하면 구조화 출력만 쓴다.
 * - 스트리밍 + finalMessage()로 받는다.
 * - Opus·Sonnet은 server-side fallback을 켠다(Haiku 5.5는 미지원).
 * - 거절(stop_reason === "refusal")을 먼저 확인하고, 호출마다 ai_calls 로그를 남긴다.
 */
export async function callClaude<S extends z.ZodType | undefined = undefined>(
  o: CallOptions<S>,
): Promise<CallResult<S>> {
  if (o.postId) await assertBudget(o.postId);
  const started = Date.now();
  const withFallback = o.model !== MODELS.haiku;

  let message: Anthropic.Beta.BetaMessage;
  try {
    message = await anthropic()
      .beta.messages.stream({
        model: o.model,
        max_tokens: o.maxTokens ?? 32000,
        system: o.system,
        messages: [{ role: "user", content: o.content }],
        output_config: {
          effort: o.effort,
          ...(o.schema ? { format: betaZodOutputFormat(o.schema) } : {}),
        },
        ...(withFallback
          ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const }
          : {}),
      })
      .finalMessage();
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) {
      throw new ApiError(429, "ai_rate_limited", "AI 요청이 많아 잠시 후 다시 시도해야 합니다.");
    }
    if (e instanceof Anthropic.APIConnectionError) {
      throw new ApiError(503, "ai_unreachable", "AI 서버에 연결하지 못했습니다.");
    }
    if (e instanceof Anthropic.APIError) {
      throw new ApiError(502, "ai_error", `AI 호출 실패(${e.status ?? "?"}): ${e.message}`);
    }
    throw e;
  }

  await db()
    .from("ai_calls")
    .insert({
      post_id: o.postId ?? null,
      purpose: o.purpose,
      model: message.model,
      input_tokens: message.usage.input_tokens,
      output_tokens: message.usage.output_tokens,
      cache_read_tokens: message.usage.cache_read_input_tokens ?? 0,
      cache_write_tokens: message.usage.cache_creation_input_tokens ?? 0,
      cost_usd: costUsd(message.model, message.usage),
      duration_ms: Date.now() - started,
    });

  if (message.stop_reason === "refusal") {
    throw new ApiError(502, "ai_refusal", "AI가 이 요청을 처리하지 않았습니다. 입력을 확인해 주세요.");
  }
  if (message.stop_reason === "max_tokens") {
    throw new ApiError(502, "ai_truncated", "AI 응답이 길이 제한으로 잘렸습니다.");
  }

  let parsed: unknown = undefined;
  if (o.schema) {
    const text = message.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    try {
      parsed = o.schema.parse(JSON.parse(text));
    } catch {
      throw new ApiError(502, "ai_bad_output", "AI 응답이 정해진 형식이 아닙니다.");
    }
  }
  return { message, parsed: parsed as CallResult<S>["parsed"] };
}
