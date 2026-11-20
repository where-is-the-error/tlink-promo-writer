import { detectInstructions } from "../ai/instructionDetect";
import { db, must } from "../db";
import { ApiError } from "../http";
import { pageCount, scanPdf } from "../ingest/pdf";
import { embed, toVector } from "../search";
import { splitSentences } from "../text";

const MAX_PDF_BYTES = 50 * 1024 * 1024;

/** POST /api/materials — PDF만 받는다. 등록 직후 상태는 'scanning'이고 검사는 응답 뒤에 돈다. */
export async function registerMaterial(file: File, name: string | null, excludePages: number[]) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const isPdf = new TextDecoder().decode(bytes.slice(0, 5)) === "%PDF-";
  if (!isPdf) throw new ApiError(400, "not_pdf", "PDF 파일만 등록할 수 있습니다.");
  if (bytes.length > MAX_PDF_BYTES) throw new ApiError(413, "file_too_large", "PDF는 50MB 이하만 등록할 수 있습니다.");

  let pages: number;
  try {
    pages = await pageCount(bytes);
  } catch {
    throw new ApiError(400, "invalid_pdf", "PDF를 읽을 수 없습니다.");
  }

  const material = must(
    await db()
      .from("materials")
      .insert({
        name: name?.trim() || file.name.replace(/\.pdf$/i, ""),
        source_file: file.name,
        kind: "pdf",
        page_count: pages,
        excluded_pages: excludePages,
      })
      .select("id")
      .single(),
  ) as { id: string };

  // 원본은 비공개 버킷에 둔다. 실패해도 등록은 계속한다(카드 생성 때 쪽 텍스트로 대신한다).
  const path = `${material.id}.pdf`;
  const up = await db().storage.from("materials").upload(path, bytes, { contentType: "application/pdf" });
  if (!up.error) await db().from("materials").update({ storage_path: path }).eq("id", material.id);

  return { material_id: material.id, bytes };
}

async function pool<T>(items: T[], size: number, fn: (item: T) => Promise<void>) {
  const queue = [...items];
  await Promise.all(Array.from({ length: size }, async () => {
    for (let item = queue.shift(); item !== undefined; item = queue.shift()) await fn(item);
  }));
}

/** 4장 3~7: 쪽 분할·텍스트 추출 → 숨은 글자 탐지 → 지시문 판별 → 격리 → 임베딩. */
export async function scanMaterial(materialId: string, bytes: Uint8Array, excludePages: number[]) {
  try {
    const scanned = (await scanPdf(bytes)).filter((p) => !excludePages.includes(p.page_no));
    const findings: { material_id: string; page_no: number; snippet: string; detector: string }[] = [];

    for (const p of scanned) {
      for (const snippet of p.hidden) {
        findings.push({ material_id: materialId, page_no: p.page_no, snippet, detector: "invisible_text" });
      }
    }
    await pool(scanned, 5, async (p) => {
      for (const f of await detectInstructions(splitSentences(p.text))) {
        findings.push({ material_id: materialId, page_no: p.page_no, snippet: f.sentence, detector: "instruction_like" });
      }
    });

    const quarantined = new Set(findings.map((f) => f.page_no));
    const clean = scanned.filter((p) => !quarantined.has(p.page_no) && p.text);
    const vectors = clean.length ? await embed(clean.map((p) => p.text), "document") : [];
    const vectorOf = new Map(clean.map((p, i) => [p.page_no, vectors[i]]));

    must(
      await db().from("material_pages").upsert(
        scanned.map((p) => ({
          material_id: materialId,
          page_no: p.page_no,
          text: p.text,
          quarantined: quarantined.has(p.page_no),
          embedding: vectorOf.has(p.page_no) ? toVector(vectorOf.get(p.page_no)!) : null,
        })),
        { onConflict: "material_id,page_no" },
      ),
    );
    if (findings.length) must(await db().from("injection_findings").insert(findings));
    await db().from("materials").update({ status: "ready" }).eq("id", materialId);
    return { pages: scanned.length, findings: findings.length };
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    await db().from("materials").update({ status: "failed", status_detail: detail }).eq("id", materialId);
    throw e;
  }
}

/** GET /api/materials — 자료 목록 + 쪽 수 + 격리 현황 + [CONFLICT] 경고. */
export async function listMaterials() {
  const [materials, pages, findings, conflicts] = await Promise.all([
    db().from("materials").select("*").order("created_at"),
    db().from("material_pages").select("material_id, quarantined"),
    db().from("injection_findings").select("*").order("created_at"),
    db().from("card_conflicts").select("*").order("created_at"),
  ]);
  const pageRows = must(pages) as { material_id: string; quarantined: boolean }[];
  const findingRows = must(findings) as { material_id: string; status: string }[];
  return {
    materials: (must(materials) as { id: string }[]).map((m) => ({
      ...m,
      indexed_pages: pageRows.filter((p) => p.material_id === m.id).length,
      quarantined_pages: pageRows.filter((p) => p.material_id === m.id && p.quarantined).length,
      injection_findings: findingRows.filter((f) => f.material_id === m.id),
    })),
    pending_findings: findingRows.filter((f) => f.status === "pending").length,
    conflicts: must(conflicts),
  };
}

/** PATCH /api/injection-findings/:id — excluded: 계속 격리 / allowed: 해당 문장을 지우고 재색인. */
export async function resolveFinding(id: string, status: "excluded" | "allowed") {
  const finding = must(await db().from("injection_findings").select("*").eq("id", id).maybeSingle()) as {
    id: string;
    material_id: string;
    page_no: number;
    snippet: string;
  } | null;
  if (!finding) throw new ApiError(404, "not_found", "격리 항목을 찾을 수 없습니다.");

  must(await db().from("injection_findings").update({ status }).eq("id", id));
  const page = must(
    await db()
      .from("material_pages")
      .select("id, text")
      .eq("material_id", finding.material_id)
      .eq("page_no", finding.page_no)
      .maybeSingle(),
  ) as { id: string; text: string } | null;
  if (!page) return { finding: { ...finding, status }, quarantined: true };

  let text = page.text;
  if (status === "allowed") text = text.split(finding.snippet).join("").replace(/\n{3,}/g, "\n\n").trim();

  const others = must(
    await db()
      .from("injection_findings")
      .select("id")
      .eq("material_id", finding.material_id)
      .eq("page_no", finding.page_no)
      .neq("status", "allowed"),
  ) as unknown[];
  const quarantined = others.length > 0;
  const embedding = !quarantined && text ? toVector((await embed([text], "document"))[0]) : null;
  must(await db().from("material_pages").update({ text, quarantined, embedding }).eq("id", page.id));
  return { finding: { ...finding, status }, quarantined };
}
