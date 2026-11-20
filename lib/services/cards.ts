import { generateCardsFromDocuments, type CardDocument } from "../ai/cards";
import { db, must } from "../db";
import { ApiError } from "../http";
import { keepPages } from "../ingest/pdf";
import type { Card } from "../types";

/** 요청 1건에 실을 수 있는 PDF 크기(전체 32MB 제한, base64로 1.37배 커짐). */
const MAX_PDF_TOTAL = 20 * 1024 * 1024;

export async function listCards(): Promise<Card[]> {
  return must(
    await db().from("cards").select("*").eq("status", "active").order("priority_score", { ascending: false }).order("code"),
  ) as Card[];
}

/**
 * POST /api/cards/generate (6-1).
 * 격리된 쪽·숨은 지시가 발견된 적 있는 쪽·등록 제외 쪽은 넣지 않는다.
 * 원본 PDF를 실을 수 있으면 PDF(page_location)로, 너무 크거나 원본이 없으면 쪽별 텍스트 블록
 * (content_block_location)으로 넣는다. 어느 쪽이든 쪽 번호는 API가 돌려준 인용 위치에서만 나온다.
 */
export async function generateCards(replace: boolean) {
  const pending = must(await db().from("injection_findings").select("id").eq("status", "pending")) as unknown[];
  if (pending.length) {
    throw new ApiError(409, "pending_findings", `격리 알림 ${pending.length}건을 먼저 처리해야 합니다.`);
  }

  const materials = must(await db().from("materials").select("*").eq("status", "ready").order("created_at")) as {
    id: string;
    name: string;
    storage_path: string | null;
  }[];
  const [pageRows, findingRows] = await Promise.all([
    db().from("material_pages").select("material_id, page_no, text, quarantined").order("page_no"),
    db().from("injection_findings").select("material_id, page_no"),
  ]);
  const pages = must(pageRows) as { material_id: string; page_no: number; text: string; quarantined: boolean }[];
  const flagged = new Set((must(findingRows) as { material_id: string; page_no: number }[]).map((f) => `${f.material_id}:${f.page_no}`));

  const docs: CardDocument[] = [];
  let pdfBudget = MAX_PDF_TOTAL;
  for (const m of materials) {
    const usable = pages.filter(
      (p) => p.material_id === m.id && !p.quarantined && !flagged.has(`${m.id}:${p.page_no}`),
    );
    if (usable.length === 0) continue;
    const keep = usable.map((p) => p.page_no);

    let pdf: Uint8Array | null = null;
    if (m.storage_path) {
      const file = await db().storage.from("materials").download(m.storage_path);
      if (file.data && file.data.size <= pdfBudget) {
        const trimmed = await keepPages(new Uint8Array(await file.data.arrayBuffer()), keep);
        if (trimmed.length <= pdfBudget) pdf = trimmed;
      }
    }
    if (pdf) {
      pdfBudget -= pdf.length;
      docs.push({ material_id: m.id, title: m.name, pages: keep, kind: "pdf", base64: Buffer.from(pdf).toString("base64") });
    } else {
      const withText = usable.filter((p) => p.text);
      if (withText.length === 0) continue;
      docs.push({
        material_id: m.id,
        title: m.name,
        pages: withText.map((p) => p.page_no),
        kind: "text",
        texts: withText.map((p) => p.text),
      });
    }
  }
  if (docs.length === 0) throw new ApiError(409, "no_materials", "카드를 만들 자료가 없습니다.");

  const { cards, conflicts } = await generateCardsFromDocuments(docs);

  const rows = cards
    .map((c) => ({
      claim: c.claim,
      benefit: c.benefit,
      condition: c.condition,
      citations: c.citations
        .map((ci) => {
          const doc = docs[ci.document_index];
          const page_no = doc?.pages[ci.position];
          return doc && page_no ? { material_id: doc.material_id, page_no, cited_text: ci.cited_text } : null;
        })
        .filter((x) => x !== null),
    }))
    .filter((c) => c.citations.length > 0); // 인용 0개인 카드는 버린다

  if (rows.length === 0) throw new ApiError(502, "no_cited_cards", "인용이 붙은 카드가 만들어지지 않았습니다.");

  if (replace) must(await db().from("cards").update({ status: "archived" }).eq("status", "active"));
  const existing = must(await db().from("cards").select("code")) as { code: string }[];
  let next = existing.reduce((max, c) => Math.max(max, Number(c.code.replace(/\D/g, "")) || 0), 0) + 1;
  must(
    await db()
      .from("cards")
      .insert(rows.map((r) => ({ ...r, code: `C-${String(next++).padStart(2, "0")}` }))),
  );

  must(await db().from("card_conflicts").delete().not("id", "is", null));
  if (conflicts.length) must(await db().from("card_conflicts").insert(conflicts.map((text) => ({ text }))));

  return { cards: await listCards(), conflicts };
}
