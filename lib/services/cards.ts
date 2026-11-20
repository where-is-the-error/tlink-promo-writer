import { generateCardsFromPages, type CardPage } from "../ai/cards";
import { db, must } from "../db";
import { ApiError } from "../http";
import type { Card } from "../types";

export async function listCards(): Promise<Card[]> {
  return must(
    await db().from("cards").select("*").eq("status", "active").order("priority_score", { ascending: false }).order("code"),
  ) as Card[];
}

/**
 * POST /api/cards/generate (6-1).
 * 격리되지 않은 쪽의 원문만 AI에 넣는다(허용 처리된 쪽은 해당 문장을 지운 원문).
 * 쪽 번호는 AI가 적은 값을 믿지 않고, 인용문이 실제로 들어 있는 쪽을 코드로 찾아 저장한다.
 */
export async function generateCards(replace: boolean) {
  const pending = must(await db().from("injection_findings").select("id").eq("status", "pending")) as unknown[];
  if (pending.length) {
    throw new ApiError(409, "pending_findings", `격리 알림 ${pending.length}건을 먼저 처리해야 합니다.`);
  }

  const materials = must(await db().from("materials").select("id, name").eq("status", "ready").order("created_at")) as {
    id: string;
    name: string;
  }[];
  const rows = must(
    await db().from("material_pages").select("material_id, page_no, text").eq("quarantined", false).order("page_no"),
  ) as { material_id: string; page_no: number; text: string }[];

  const pages: CardPage[] = materials.flatMap((m) =>
    rows
      .filter((p) => p.material_id === m.id && p.text.trim())
      .map((p) => ({ material_id: m.id, material: m.name, page_no: p.page_no, text: p.text })),
  );
  if (pages.length === 0) throw new ApiError(409, "no_materials", "카드를 만들 자료가 없습니다.");

  const { cards, conflicts } = await generateCardsFromPages(pages);
  if (cards.length === 0) throw new ApiError(502, "no_cited_cards", "원문 인용이 확인된 카드가 만들어지지 않았습니다.");

  if (replace) must(await db().from("cards").update({ status: "archived" }).eq("status", "active"));
  const existing = must(await db().from("cards").select("code")) as { code: string }[];
  let next = existing.reduce((max, c) => Math.max(max, Number(c.code.replace(/\D/g, "")) || 0), 0) + 1;
  must(
    await db()
      .from("cards")
      .insert(cards.map((c) => ({ ...c, code: `C-${String(next++).padStart(2, "0")}` }))),
  );

  must(await db().from("card_conflicts").delete().not("id", "is", null));
  if (conflicts.length) must(await db().from("card_conflicts").insert(conflicts.map((text) => ({ text }))));

  return { cards: await listCards(), conflicts };
}
