import { classifyIntros, type IntroType } from "./ai/instructionDetect";
import { db, must } from "./db";
import { ApiError } from "./http";

const INTRO_LABEL: Record<IntroType, string> = { question: "질문형", number: "숫자형", situation: "상황형" };

export interface Reaction {
  views: number | null;
  likes: number | null;
  comments: number | null;
  inquiries: number | null;
}

/** 12장: 문의 전화 × 5 + 공감 + 댓글 × 2 + 조회수 ÷ 100 */
export function reactionScore(r: Reaction): number {
  return (r.inquiries ?? 0) * 5 + (r.likes ?? 0) + (r.comments ?? 0) * 2 + (r.views ?? 0) / 100;
}

/** 카드별 점수 = 그 카드를 앞세운 게시 글들의 반응 점수 평균. */
export function cardScores(posts: { leadCards: string[]; score: number }[]): Map<string, number> {
  const sums = new Map<string, { total: number; n: number }>();
  for (const p of posts) {
    for (const code of new Set(p.leadCards)) {
      const s = sums.get(code) ?? { total: 0, n: 0 };
      sums.set(code, { total: s.total + p.score, n: s.n + 1 });
    }
  }
  return new Map([...sums].map(([code, s]) => [code, s.total / s.n]));
}

/** 수정 전에만 있고 수정 후에는 없는 어절(담당자가 지운 표현). */
export function removedTokens(before: string, after: string): string[] {
  const clean = (t: string) => t.replace(/^[^\p{L}\p{N}%]+|[^\p{L}\p{N}%]+$/gu, "");
  const kept = new Set(after.split(/\s+/).map(clean));
  return [...new Set(before.split(/\s+/).map(clean).filter((t) => t.length >= 2 && !kept.has(t)))];
}

/** 2회 이상(서로 다른 수정에서) 지운 어절. */
export function bannedFromEdits(edits: { before: string; after: string }[], min = 2): { phrase: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const e of edits) for (const t of removedTokens(e.before, e.after)) counts.set(t, (counts.get(t) ?? 0) + 1);
  return [...counts].filter(([, n]) => n >= min).map(([phrase, count]) => ({ phrase, count }));
}

interface RuleDraft {
  kind: "card_order" | "banned_phrase" | "preferred_intro";
  key: string;
  value: object;
  evidence_count: number;
  strength: "weak" | "ok";
}

/** POST /api/learning/recompute — 12장 규칙 3종을 다시 계산한다. 담당자가 끈 규칙(active=false)은 그대로 둔다. */
export async function recomputeLearning() {
  const posts = must(
    await db().from("posts").select("id, status, reactions(*)").in("status", ["approved", "published"]).eq("is_eval", false),
  ) as { id: string; status: string; reactions: Reaction | Reaction[] | null }[];
  const ids = posts.map((p) => p.id);
  const [sentenceRows, editRows] = ids.length
    ? await Promise.all([
        db().from("sentences").select("id, post_id, section_no, order_no, text, source_type, source_ref").in("post_id", ids).eq("deleted", false),
        db().from("edits").select("sentence_id, kind, before, after").in("post_id", ids),
      ])
    : [{ data: [], error: null }, { data: [], error: null }];
  const sentences = (must(sentenceRows) as {
    id: string; post_id: string; section_no: number; order_no: number; text: string; source_type: string; source_ref: string;
  }[]).sort((a, b) => a.section_no - b.section_no || a.order_no - b.order_no);
  const edits = must(editRows) as { sentence_id: string | null; kind: string; before: string | null; after: string | null }[];
  const drafts: RuleDraft[] = [];

  // 1) 카드 순서: 1단계에 쓴 카드(없으면 글에서 처음 나온 카드)를 "앞세운 카드"로 본다
  const scored = posts.flatMap((p) => {
    const reaction = Array.isArray(p.reactions) ? p.reactions[0] : p.reactions;
    if (p.status !== "published" || !reaction) return [];
    const cardRefs = sentences.filter((s) => s.post_id === p.id && s.source_type === "card");
    const lead = cardRefs.filter((s) => s.section_no === 1).map((s) => s.source_ref);
    return [{ leadCards: lead.length ? lead : cardRefs.slice(0, 1).map((s) => s.source_ref), score: reactionScore(reaction) }];
  });
  const scores = cardScores(scored);
  must(await db().from("cards").update({ priority_score: 0 }).not("id", "is", null));
  for (const [code, score] of scores) must(await db().from("cards").update({ priority_score: score }).eq("code", code));
  if (scores.size > 0) {
    drafts.push({
      kind: "card_order",
      key: "card_order",
      value: { order: [...scores].sort((a, b) => b[1] - a[1]).map(([code, score]) => ({ code, score })) },
      evidence_count: scored.length,
      strength: scored.length < 5 ? "weak" : "ok", // 반응이 입력된 글 5건 미만이면 약한 근거
    });
  }

  // 2) 금지 표현
  const textEdits = edits.filter((e) => e.kind === "edit" && e.before && e.after) as { before: string; after: string }[];
  for (const b of bannedFromEdits(textEdits)) {
    drafts.push({ kind: "banned_phrase", key: b.phrase, value: { phrase: b.phrase }, evidence_count: b.count, strength: "ok" });
  }

  // 3) 선호 도입부: 1단계 첫 문장이 수정 없이 승인된 글의 문장 유형
  const edited = new Set(edits.map((e) => e.sentence_id));
  const intros = posts
    .map((p) => sentences.find((s) => s.post_id === p.id && s.section_no === 1))
    .filter((s) => s !== undefined && !edited.has(s.id)) as { text: string }[];
  if (intros.length >= 2) {
    const types = await classifyIntros(intros.map((s) => s.text));
    for (const type of ["question", "number", "situation"] as const) {
      const n = types.filter((t) => t === type).length;
      if (n >= 2) {
        drafts.push({ kind: "preferred_intro", key: type, value: { type, label: INTRO_LABEL[type] }, evidence_count: n, strength: "ok" });
      }
    }
  }

  // 저장: 같은 규칙은 갱신(끄고 켠 상태 유지), 근거가 사라진 규칙은 지운다
  const keyOf = (kind: string, value: { phrase?: string; type?: string }) => `${kind}:${value.phrase ?? value.type ?? kind}`;
  const existing = must(await db().from("learned_rules").select("*")) as { id: string; kind: string; value: object }[];
  const seen = new Set<string>();
  for (const d of drafts) {
    const key = `${d.kind}:${d.key}`;
    seen.add(key);
    const row = { kind: d.kind, value: d.value, evidence_count: d.evidence_count, strength: d.strength, updated_at: new Date().toISOString() };
    const old = existing.find((e) => keyOf(e.kind, e.value) === key);
    if (old) must(await db().from("learned_rules").update(row).eq("id", old.id));
    else must(await db().from("learned_rules").insert(row));
  }
  const stale = existing.filter((e) => !seen.has(keyOf(e.kind, e.value))).map((e) => e.id);
  if (stale.length) must(await db().from("learned_rules").delete().in("id", stale));

  return listRules();
}

export async function listRules() {
  return { rules: must(await db().from("learned_rules").select("*").order("kind").order("updated_at", { ascending: false })) };
}

/** 06 화면: 규칙 끄고 켜기. 꺼진 규칙은 글 쓰기 입력에 넣지 않는다. */
export async function setRuleActive(id: string, active: boolean) {
  const rows = must(await db().from("learned_rules").update({ active }).eq("id", id).select("*")) as unknown[];
  if (rows.length === 0) throw new ApiError(404, "not_found", "규칙을 찾을 수 없습니다.");
  return { rule: rows[0] };
}
