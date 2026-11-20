import { z } from "zod";
import { compact } from "../text";
import type { CardCitation } from "../types";
import { callModel, MODELS } from "./client";
import { CARDS_SYSTEM, tag } from "./prompts";

export interface CardPage {
  material_id: string;
  material: string;
  page_no: number;
  text: string;
}

const CardsSchema = z.object({
  cards: z.array(
    z.object({
      claim: z.string(),
      benefit: z.string(),
      condition: z.string().nullable(),
      quotes: z.array(z.object({ material: z.string(), page_no: z.number().int(), quote: z.string() })),
    }),
  ),
  conflicts: z.array(z.string()),
  injection_notes: z.array(z.string()),
});
type RawCard = z.infer<typeof CardsSchema>["cards"][number];

export interface VerifiedCard {
  claim: string;
  benefit: string;
  condition: string | null;
  citations: CardCitation[];
}

/**
 * 카드 인용의 실재 확인(순수 함수).
 * 쪽 번호는 AI가 적은 값을 믿지 않는다. 인용문이 쪽 원문에 글자 그대로 들어 있는지 코드로 찾아
 * 실제로 들어 있는 쪽의 번호만 저장한다(AI가 적은 쪽에 없으면 같은 자료 → 다른 자료 순으로 찾는다).
 * 어디에서도 찾지 못한 인용은 버리고, 인용이 0개가 된 카드도 버린다.
 */
export function verifyCardQuotes(cards: RawCard[], pages: CardPage[]): VerifiedCard[] {
  const compacted = pages.map((p) => ({ ...p, c: compact(p.text) }));
  const out: VerifiedCard[] = [];
  for (const card of cards) {
    const citations: CardCitation[] = [];
    for (const q of card.quotes) {
      const quote = compact(q.quote);
      if (quote.length < 4) continue;
      const hit =
        compacted.find((p) => p.material === q.material && p.page_no === q.page_no && p.c.includes(quote)) ??
        compacted.find((p) => p.material === q.material && p.c.includes(quote)) ??
        compacted.find((p) => p.c.includes(quote));
      if (hit && !citations.some((c) => c.material_id === hit.material_id && c.page_no === hit.page_no && c.cited_text === q.quote)) {
        citations.push({ material_id: hit.material_id, page_no: hit.page_no, cited_text: q.quote.trim() });
      }
    }
    const claim = card.claim.trim();
    const benefit = card.benefit.trim();
    const condition = card.condition?.trim() || null;
    if (claim && benefit && citations.length > 0) {
      out.push({ claim, benefit, condition: condition && !/^없음\.?$/.test(condition) ? condition : null, citations });
    }
  }
  return out;
}

/** 6-1 차별점 카드 생성 — 격리되지 않은 쪽 원문만 넣고, 인용문은 코드로 실재 확인한다. */
export async function generateCardsFromPages(pages: CardPage[]) {
  const text = [
    `<documents>\n${pages
      .map((p) => tag("page", p.text, { material: p.material, no: p.page_no }))
      .join("\n")}\n</documents>`,
    "위 자료에서 차별점 카드를 만들어 줘. 카드마다 근거가 되는 원문 구절을 quotes에 글자 그대로 넣어야 한다.",
  ].join("\n\n");

  const result = await callModel({
    purpose: "cards",
    model: MODELS.pro,
    system: CARDS_SYSTEM,
    parts: [{ text }],
    schema: CardsSchema,
    maxTokens: 64000,
  });
  return {
    cards: verifyCardQuotes(result.cards, pages),
    conflicts: result.conflicts.map((c) => c.trim()).filter(Boolean),
    injection_notes: result.injection_notes,
  };
}
