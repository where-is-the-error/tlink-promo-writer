import { z } from "zod";
import type { Guideline } from "../types";
import { callModel, MODELS } from "./client";
import { cardTag, tag, WRITE_SYSTEM } from "./prompts";

export const WriteSchema = z.object({
  title: z.string(),
  sections: z.array(
    z.object({
      section_no: z.number().int(),
      sentences: z.array(
        z.object({
          text: z.string(),
          source_type: z.enum(["card", "photo", "memo"]),
          source_ref: z.string(),
        }),
      ),
    }),
  ),
  omitted_missions: z.array(z.object({ no: z.number().int(), reason: z.string() })),
  hashtags: z.array(z.string()),
  injection_notes: z.array(z.string()),
});
export type WriteResult = z.infer<typeof WriteSchema>;

export interface WriteInput {
  postId: string;
  memo: string;
  guideline: Guideline;
  /** 담당자가 고른 카드만. priority_score 내림차순 */
  cards: { code: string; claim: string; benefit: string; condition: string | null }[];
  /** 가이드라인 순서로 정렬된 사진 */
  photos: { id: string; kind: string | null; screen_type: string | null; description: string }[];
  rules: { banned_phrases: string[]; preferred_intros: string[] };
}

/** 6-3 글 쓰기 — Gemini(flash), 구조화 출력. 하단 정보·기본 해시태그는 코드가 붙인다. */
export async function writeDraft(input: WriteInput): Promise<WriteResult> {
  const g = input.guideline;
  const guidelineText = [
    "본문 5단계:",
    ...g.sections.map((s) => `${s.no}. ${s.title} — ${s.intent}`),
    "",
    `필수 키워드(제목과 본문에 모두): ${g.required_keywords.join(", ")}`,
    `제목 문구 4개(제목과 첫 문단에): ${g.title_phrases.join(", ")}`,
    "",
    "강조 항목(missions):",
    ...g.missions.map((m) => `${m.no}) ${m.text}`),
  ].join("\n");

  const rulesText = [
    `금지 표현: ${input.rules.banned_phrases.join(", ") || "(없음)"}`,
    `선호 도입부 유형: ${input.rules.preferred_intros.join(", ") || "(없음)"}`,
  ].join("\n");

  const text = [
    `<guideline>\n${guidelineText}\n</guideline>`,
    `<rules>\n${rulesText}\n</rules>`,
    `<cards>\n${input.cards.map(cardTag).join("\n")}\n</cards>`,
    `<photos>\n${input.photos
      .map((p) => tag("photo_text", p.description, { id: p.id, kind: p.kind ?? "", screen_type: p.screen_type ?? "" }))
      .join("\n")}\n</photos>`,
    tag("memo", input.memo),
    "위 카드·사진·메모만으로 5단계 후기형 글을 써 줘.",
  ].join("\n\n");

  const parsed = await callModel({
    purpose: "write",
    model: MODELS.flash,
    system: WRITE_SYSTEM,
    parts: [{ text }],
    schema: WriteSchema,
    postId: input.postId,
  });
  return parsed;
}
