import { z } from "zod";
import { callModel, MODELS, type Part } from "./client";
import { cardTag, CLASSIFY_SYSTEM, tag } from "./prompts";

export const ClassifySchema = z.object({
  photos: z.array(
    z.object({
      photo_id: z.string(),
      kind: z.enum(["site", "screen", "scene"]),
      screen_type: z.enum(["phone_call", "voip_list", "ai_summary", "staff_stats", "report"]).nullable(),
      description: z.string(),
      recommended_cards: z.array(z.object({ code: z.string(), reason: z.string() })),
    }),
  ),
  missing_screen_types: z.array(z.string()),
  injection_notes: z.array(z.string()),
});
export type ClassifyResult = z.infer<typeof ClassifySchema>;

export interface PhotoInput {
  id: string;
  mediaType: "image/png" | "image/jpeg" | "image/webp" | "image/gif";
  base64: string;
}

/** 6-2 사진 분류 + 카드 추천 — Gemini(flash), 구조화 출력. */
export async function classifyPhotos(input: {
  postId: string;
  memo: string;
  photos: PhotoInput[];
  cards: { code: string; claim: string; benefit: string; condition: string | null }[];
}): Promise<ClassifyResult> {
  const parts: Part[] = [];
  for (const p of input.photos) {
    parts.push({ text: `<photo id="${p.id}">` });
    parts.push({ inlineData: { mimeType: p.mediaType, data: p.base64 } });
    parts.push({ text: "</photo>" });
  }
  parts.push({

    text: [
      tag("memo", input.memo),
      `<cards>\n${input.cards.map(cardTag).join("\n")}\n</cards>`,
      "위 사진을 모두 분류하고, 사진마다 카드 3개를 추천해 줘. photo_id는 <photo>의 id를 그대로 쓴다.",
    ].join("\n\n"),
  });

  const parsed = await callModel({
    purpose: "classify",
    model: MODELS.flash,
    system: CLASSIFY_SYSTEM,
    parts,
    schema: ClassifySchema,
    postId: input.postId,
    maxTokens: 16000,
  });
  return parsed;
}
