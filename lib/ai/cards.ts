import type Anthropic from "@anthropic-ai/sdk";
import { callClaude, MODELS } from "./client";
import { CARDS_SYSTEM } from "./prompts";

/** 카드 생성에 넣는 자료 1개. `pages[i]`는 문서 안 i번째 쪽(또는 블록)의 원본 쪽 번호다. */
export type CardDocument = {
  material_id: string;
  title: string;
  pages: number[];
} & ({ kind: "pdf"; base64: string } | { kind: "text"; texts: string[] });

export interface ParsedCitation {
  document_index: number;
  /** 문서 안에서의 0-기준 위치(PDF 쪽 순번 또는 텍스트 블록 순번) */
  position: number;
  cited_text: string;
}

export interface ParsedCard {
  claim: string;
  benefit: string;
  condition: string | null;
  citations: ParsedCitation[];
}

interface TextBlockLike {
  type: string;
  text?: string;
  citations?: Array<Record<string, unknown>> | null;
}

function field(body: string, label: string): string | null {
  const m = body.match(new RegExp(`${label}\\s*[:：]\\s*(.+)`));
  return m ? m[1].trim() : null;
}

/**
 * 6-1 파싱. text 블록을 순서대로 이어 붙여 [CARD] 단위로 나누고,
 * 각 카드 구간과 겹치는 text 블록의 citations에서 쪽 위치를 모은다.
 * 쪽 번호는 AI가 쓴 글자가 아니라 API가 돌려준 인용 위치에서만 나온다. 인용 0개인 카드는 버린다.
 */
export function parseCardsResponse(blocks: TextBlockLike[]): { cards: ParsedCard[]; conflicts: string[] } {
  let full = "";
  const spans: { start: number; end: number; citations: ParsedCitation[] }[] = [];
  for (const b of blocks) {
    if (b.type !== "text" || typeof b.text !== "string") continue;
    const citations: ParsedCitation[] = [];
    for (const c of b.citations ?? []) {
      const base = { document_index: Number(c.document_index), cited_text: String(c.cited_text ?? "") };
      if (c.type === "page_location") {
        citations.push({ ...base, position: Number(c.start_page_number) - 1 });
      } else if (c.type === "content_block_location") {
        citations.push({ ...base, position: Number(c.start_block_index) });
      }
    }
    spans.push({ start: full.length, end: full.length + b.text.length, citations });
    full += b.text;
  }

  const cards: ParsedCard[] = [];
  for (const m of full.matchAll(/\[CARD\]([\s\S]*?)\[\/CARD\]/g)) {
    const start = m.index;
    const end = start + m[0].length;
    const claim = field(m[1], "주장");
    const benefit = field(m[1], "이익");
    const condition = field(m[1], "조건");
    if (!claim || !benefit) continue;

    const seen = new Set<string>();
    const citations = spans
      .filter((s) => s.start < end && s.end > start)
      .flatMap((s) => s.citations)
      .filter((c) => {
        const key = `${c.document_index}:${c.position}:${c.cited_text}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    if (citations.length === 0) continue;

    cards.push({
      claim,
      benefit,
      condition: !condition || /^없음\.?$/.test(condition) ? null : condition,
      citations,
    });
  }

  const conflicts = [...full.matchAll(/\[CONFLICT\]([\s\S]*?)\[\/CONFLICT\]/g)]
    .map((m) => m[1].trim())
    .filter(Boolean);
  return { cards, conflicts };
}

/** 6-1 차별점 카드 생성 — Opus 5.5, effort high, Citations(구조화 출력과 함께 못 쓰므로 텍스트 + 파싱). */
export async function generateCardsFromDocuments(docs: CardDocument[]) {
  const content: Anthropic.Beta.BetaContentBlockParam[] = docs.map((d, i) => ({
    type: "document",
    title: d.title,
    citations: { enabled: true },
    source:
      d.kind === "pdf"
        ? { type: "base64", media_type: "application/pdf", data: d.base64 }
        : { type: "content", content: d.texts.map((text) => ({ type: "text" as const, text })) },
    // 문서 블록 끝에 캐시 지점: 다시 만들 때 자료 묶음을 재사용한다.
    ...(i === docs.length - 1 ? { cache_control: { type: "ephemeral" as const } } : {}),
  }));
  content.push({
    type: "text",
    text: "위 자료에서 차별점 카드를 만들어 줘. 정해진 [CARD] 형식만 출력하고, 주장 문장은 반드시 자료를 인용하면서 써.",
  });

  const { message } = await callClaude({
    purpose: "cards",
    model: MODELS.opus,
    effort: "high",
    system: CARDS_SYSTEM,
    content,
    maxTokens: 64000,
  });
  return parseCardsResponse(message.content as TextBlockLike[]);
}
