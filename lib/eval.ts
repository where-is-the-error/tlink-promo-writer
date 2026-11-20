import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { detectInstructions } from "./ai/instructionDetect";
import { db, must } from "./db";
import { ApiError } from "./http";
import { scanPdf } from "./ingest/pdf";
import { addPhoto, classifyPost, createPost, setChoice, verifyPost, writePost } from "./services/posts";
import { compact, splitSentences } from "./text";

/**
 * eval/cases/E-xx/expected.json 형식
 *  - type: "post"(기본) | "injection_pdf" | "skip"(브라우저 단위 테스트로 확인하는 사례)
 *  - traps: 글에 남으면 안 되는 틀린 주장의 핵심 구절. 그 구절이 든 문장이 모두 "확인 필요"여야 탐지로 센다.
 *  - expected_pages: match 문장의 근거로 맞는 쪽 [{material, page_no}]
 *  - must_not_contain: 최종 글에 0회여야 하는 표현
 */
interface Expected {
  type?: "post" | "injection_pdf" | "skip";
  traps?: string[];
  expected_pages?: { material: string; page_no: number }[];
  must_not_contain?: string[];
}

const MIME: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" };

/** POST /api/eval/run (13장) — 평가 사례를 실제 파이프라인으로 돌리고 eval_runs에 1행을 남긴다. */
export async function runEval() {
  const root = path.join(process.cwd(), "eval", "cases");
  const names = (await readdir(root).catch(() => [])).filter((n) => /^E-\d+/.test(n)).sort();
  if (names.length === 0) throw new ApiError(409, "no_eval_cases", "eval/cases/E-xx 평가 사례가 없습니다.");

  const results: Record<string, unknown>[] = [];
  const banned: string[] = [];
  const texts: string[] = [];
  const postIds: string[] = [];
  let pagesOk = 0, pagesTotal = 0, trapHit = 0, trapTotal = 0, injHit = 0, injTotal = 0;

  for (const name of names) {
    const dir = path.join(root, name);
    try {
      const expected = JSON.parse(await readFile(path.join(dir, "expected.json"), "utf8").catch(() => "{}")) as Expected;
      banned.push(...(expected.must_not_contain ?? []));
      if (expected.type === "skip") {
        results.push({ case: name, status: "skipped" });
        continue;
      }

      if (expected.type === "injection_pdf") {
        // 숨은 지시 PDF: DB에 넣지 않고 등록 검사만 돌려 격리 대상이 되는지 본다
        injTotal++;
        const file = (await readdir(dir)).find((f) => f.toLowerCase().endsWith(".pdf"));
        if (!file) throw new Error("PDF 파일이 없습니다.");
        let found = 0;
        for (const p of await scanPdf(new Uint8Array(await readFile(path.join(dir, file))))) {
          found += p.hidden.length + (await detectInstructions(splitSentences(p.text))).length;
        }
        if (found > 0) injHit++;
        results.push({ case: name, type: "injection_pdf", status: found > 0 ? "pass" : "fail", findings: found });
        continue;
      }

      const memo = (await readFile(path.join(dir, "memo.txt"), "utf8")).trim();
      const { post_id } = await createPost(memo, true);
      postIds.push(post_id);
      const photoDir = path.join(dir, "photos");
      for (const f of (await readdir(photoDir).catch(() => [])).sort()) {
        const type = MIME[path.extname(f).toLowerCase()];
        if (type) await addPhoto(post_id, new File([new Uint8Array(await readFile(path.join(photoDir, f)))], f, { type }), true);
      }
      const classified = await classifyPost(post_id);
      for (const c of classified.choices.filter((c) => c.rank === 1)) await setChoice(post_id, c.photo_id, c.card_id, true);
      await writePost(post_id, false);
      const { post, sentences } = await verifyPost(post_id);
      const live = sentences.filter((s) => !s.deleted);
      texts.push(`${post.title ?? ""} ${live.filter((s) => s.verdict === "match").map((s) => s.text).join(" ")}`);

      // 함정: 그 구절이 든 문장이 하나도 "일치"로 통과하지 않으면 탐지(아예 안 쓴 경우 포함)
      const traps = (expected.traps ?? []).map((t) => {
        const hits = live.filter((s) => compact(s.text).includes(compact(t)));
        return { trap: t, detected: hits.every((s) => s.verdict !== "match"), sentences: hits.length };
      });
      trapTotal += traps.length;
      trapHit += traps.filter((t) => t.detected).length;

      // 쪽수 정확도: match 문장의 자료 근거가 정답 쪽 목록에 있는 비율
      let ok = 0, total = 0;
      if (expected.expected_pages) {
        for (const s of live.filter((s) => s.verdict === "match")) {
          for (const e of s.evidence.filter((e) => e.material_id)) {
            total++;
            if (expected.expected_pages.some((p) => p.material === e.material && p.page_no === e.page_no)) ok++;
          }
        }
        pagesOk += ok;
        pagesTotal += total;
      }
      results.push({
        case: name,
        type: "post",
        status: traps.every((t) => t.detected) ? "pass" : "fail",
        post_id,
        sentences: live.length,
        needs_review: live.filter((s) => s.verdict !== "match").length,
        traps,
        pages: expected.expected_pages ? { correct: ok, total } : null,
      });
    } catch (e) {
      results.push({ case: name, status: "error", error: e instanceof Error ? e.message : String(e) });
    }
  }

  // 숨은 지시가 최종 글(일치로 통과한 문장)에 반영된 건수
  const leaked = [...new Set(banned)].filter((b) => texts.some((t) => compact(t).includes(compact(b))));
  const calls = postIds.length
    ? (must(await db().from("ai_calls").select("cost_usd").in("post_id", postIds)) as { cost_usd: number }[])
    : [];
  const avgCost = postIds.length ? calls.reduce((sum, c) => sum + Number(c.cost_usd), 0) / postIds.length : null;

  const run = must(
    await db()
      .from("eval_runs")
      .insert({
        results: { cases: results, leaked_phrases: leaked },
        page_accuracy: pagesTotal ? pagesOk / pagesTotal : null,
        trap_detected: trapHit,
        trap_total: trapTotal,
        injection_detected: leaked.length ? 0 : injHit,
        injection_total: injTotal,
        avg_cost_usd: avgCost,
      })
      .select("*")
      .single(),
  );
  return { run };
}

export async function latestEvalRuns() {
  return { runs: must(await db().from("eval_runs").select("*").order("created_at", { ascending: false }).limit(10)) };
}


