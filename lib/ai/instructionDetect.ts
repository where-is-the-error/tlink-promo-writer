import { z } from "zod";
import { callModel, MODELS } from "./client";
import { INSTRUCTION_SYSTEM, INTRO_TYPE_SYSTEM, safe } from "./prompts";

const FlagsSchema = z.object({
  flags: z.array(z.object({ index: z.number().int(), reason: z.string() })),
});

function numbered(sentences: string[]): string {
  return `<sentences>\n${sentences.map((s, i) => `${i + 1}. ${safe(s)}`).join("\n")}\n</sentences>`;
}

/** 6-5 지시문 판별 — Gemini(lite), 구조화 출력. 걸린 문장과 이유를 돌려준다. */
export async function detectInstructions(sentences: string[]): Promise<{ sentence: string; reason: string }[]> {
  if (sentences.length === 0) return [];
  const parsed = await callModel({
    purpose: "instruction_detect",
    model: MODELS.lite,
    system: INSTRUCTION_SYSTEM,
    parts: [{ text: numbered(sentences) }],
    schema: FlagsSchema,
    maxTokens: 8000,
  });
  return parsed.flags
    .filter((f) => f.index >= 1 && f.index <= sentences.length)
    .map((f) => ({ sentence: sentences[f.index - 1], reason: f.reason }));
}

const IntroSchema = z.object({
  types: z.array(z.object({ index: z.number().int(), type: z.enum(["question", "number", "situation"]) })),
});
export type IntroType = "question" | "number" | "situation";

/** 12장 선호 도입부: 첫 문장 유형 분류(Gemini lite). 입력 순서대로 유형을 돌려준다(분류 실패는 null). */
export async function classifyIntros(sentences: string[]): Promise<(IntroType | null)[]> {
  if (sentences.length === 0) return [];
  const parsed = await callModel({
    purpose: "intro_type",
    model: MODELS.lite,
    system: INTRO_TYPE_SYSTEM,
    parts: [{ text: numbered(sentences) }],
    schema: IntroSchema,
    maxTokens: 4000,
  });
  return sentences.map((_, i) => parsed.types.find((t) => t.index === i + 1)?.type ?? null);
}
