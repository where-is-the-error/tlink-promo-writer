import { z } from "zod";
import { compact } from "../text";
import type { Evidence, Verdict } from "../types";
import { callModel, MODELS } from "./client";
import { tag, VERIFY_CHECKLIST_NOTE, VERIFY_SYSTEM } from "./prompts";

const ResultSchema = z.object({
  sentence_id: z.string(),
  verdict: z.enum(["match", "exaggeration", "unsupported"]),
  reason: z.string(),
  evidence: z.array(z.object({ material: z.string(), page_no: z.number().int(), quote: z.string() })),
  suggestion: z.string().nullable(),
});

const PartialSchema = z.object({
  results: z.array(ResultSchema),
  injection_notes: z.array(z.string()),
});

const FullSchema = PartialSchema.extend({
  ai_checklist: z.object({
    review_format: z.enum(["pass", "fail"]),
    conclusion_message: z.enum(["pass", "fail"]),
    notes: z.string(),
  }),
});

export type VerifyResult = z.infer<typeof PartialSchema> & {
  ai_checklist?: z.infer<typeof FullSchema>["ai_checklist"];
};

export interface VerifyPage {
  material_id: string;
  material: string;
  page_no: number;
  text: string;
}

export interface VerifyInput {
  postId: string;
  /** true면 글 전체 검증(AI 점검표 포함), false면 일부 문장만 재검증 */
  full: boolean;
  memo: string;
  sentences: { id: string; section_no: number; text: string; source_type: string; source_ref: string }[];
  pages: VerifyPage[];
  photos: { id: string; description: string }[];
}

/**
 * 6-4 원문 대조 검증 — Gemini(pro), 구조화 출력.
 * 글 쓰기 프롬프트와 카드 생성 프롬프트는 넣지 않는다(글을 쓴 AI와 별도 호출).
 */
export async function verifySentences(input: VerifyInput): Promise<VerifyResult> {
  const text = [
    `<pages>\n${input.pages
      .map((p) => tag("page", p.text, { material: p.material, no: p.page_no }))
      .join("\n")}\n</pages>`,
    `<photos>\n${input.photos.map((p) => tag("photo_text", p.description, { id: p.id })).join("\n")}\n</photos>`,
    tag("memo", input.memo),
    `<sentences>\n${input.sentences
      .map((s) => tag("sentence", s.text, { id: s.id, section: s.section_no, source: `${s.source_type}:${s.source_ref}` }))
      .join("\n")}\n</sentences>`,
    `모든 <sentence>를 하나씩 판정해 줘. sentence_id는 id 속성을 그대로 쓴다.${
      input.full ? `\n\n${VERIFY_CHECKLIST_NOTE}` : ""
    }`,
  ].join("\n\n");

  const parsed = await callModel({
    purpose: input.full ? "verify" : "verify_sentence",
    model: MODELS.pro,
    system: VERIFY_SYSTEM,
    parts: [{ text }],
    schema: input.full ? FullSchema : PartialSchema,
    postId: input.postId,
  });
  return parsed;
}

/**
 * 6-4 서버 후처리(순수 함수).
 * evidence의 quote가 해당 원문에 실제로 들어 있는지(공백 정규화 후 부분 문자열) 코드로 확인한다.
 * 들어 있지 않은 근거는 버리고, 근거가 0개가 된 match는 unsupported로 바꾼다.
 */
export function checkEvidence(
  result: { verdict: Verdict; reason: string; evidence: { material: string; page_no: number; quote: string }[] },
  sources: { pages: VerifyPage[]; photos: { id: string; description: string }[]; memo: string },
): { verdict: Verdict; reason: string; evidence: Evidence[] } {
  const evidence: Evidence[] = [];
  for (const ev of result.evidence) {
    const quote = compact(ev.quote);
    if (quote.length < 2) continue;

    let sourceText: string | undefined;
    let materialId: string | null = null;
    if (ev.material === "memo") {
      sourceText = sources.memo;
    } else if (ev.material.startsWith("photo:")) {
      sourceText = sources.photos.find((p) => p.id === ev.material.slice(6))?.description;
    } else {
      const page = sources.pages.find((p) => p.material === ev.material && p.page_no === ev.page_no);
      sourceText = page?.text;
      materialId = page?.material_id ?? null;
    }
    if (sourceText && compact(sourceText).includes(quote)) {
      evidence.push({ material_id: materialId, material: ev.material, page_no: ev.page_no, quote: ev.quote });
    }
  }

  if (result.verdict === "match" && evidence.length === 0) {
    return {
      verdict: "unsupported",
      reason: `${result.reason} (인용한 근거가 원문에서 확인되지 않아 근거 없음으로 바꿈)`,
      evidence,
    };
  }
  return { verdict: result.verdict, reason: result.reason, evidence };
}
