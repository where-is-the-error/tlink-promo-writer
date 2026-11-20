import { classifyPhotos, type PhotoInput } from "../ai/classify";
import { checkEvidence, verifySentences, type VerifyPage } from "../ai/verify";
import { writeDraft } from "../ai/write";
import { buildExport, runCodeChecks } from "../checks";
import { db, getGuideline, must } from "../db";
import { ApiError } from "../http";
import { embed, matchPages } from "../search";
import { SCREEN_ORDER, type Card, type Photo, type Post, type Sentence } from "../types";

const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

// ───────── 공통 조회 ─────────

export async function getPostRow(postId: string): Promise<Post> {
  const post = must(await db().from("posts").select("*").eq("id", postId).maybeSingle()) as Post | null;
  if (!post) throw new ApiError(404, "not_found", "글을 찾을 수 없습니다.");
  return post;
}

async function getPhotos(postId: string): Promise<Photo[]> {
  return must(
    await db().from("photos").select("*").eq("post_id", postId).order("order_index", { nullsFirst: false }).order("created_at"),
  ) as Photo[];
}

async function getSentences(postId: string): Promise<Sentence[]> {
  return must(
    await db().from("sentences").select("*").eq("post_id", postId).order("section_no").order("order_no"),
  ) as Sentence[];
}

interface Choice {
  photo_id: string;
  card_id: string;
  rank: number;
  reason: string | null;
  selected: boolean;
  card: Card;
}

async function getChoices(postId: string): Promise<Choice[]> {
  return must(
    await db().from("photo_card_choices").select("*, card:cards(*)").eq("post_id", postId).order("rank"),
  ) as Choice[];
}

async function addInjectionNotes(post: Post, notes: string[]) {
  if (notes.length === 0) return;
  const merged = [...new Set([...(post.injection_notes ?? []), ...notes])];
  must(await db().from("posts").update({ injection_notes: merged }).eq("id", post.id));
}

function requireDraft(post: Post) {
  if (post.status !== "draft") throw new ApiError(409, "not_draft", "승인된 글은 고칠 수 없습니다.");
}

// ───────── 목록·상세 ─────────

export async function listPosts() {
  return {
    posts: must(
      await db().from("posts").select("*, reactions(*)").eq("is_eval", false).order("created_at", { ascending: false }),
    ),
  };
}

/** GET /api/posts/:id — 화면 03~05가 쓰는 전체 상태. 사진은 서명 URL(10분)로만 내려간다. */
export async function getPost(postId: string) {
  const post = await getPostRow(postId);
  const [photos, choices, sentences, checklist] = await Promise.all([
    getPhotos(postId),
    getChoices(postId),
    getSentences(postId),
    db().from("checklist_results").select("*").eq("post_id", postId),
  ]);
  const signed = photos.length
    ? await db().storage.from("photos").createSignedUrls(photos.map((p) => p.storage_path), 600)
    : { data: [] };
  const live = sentences.filter((s) => !s.deleted);
  const needsReview = live.filter((s) => s.verdict === "exaggeration" || s.verdict === "unsupported").length;
  const checks = must(checklist) as { status: string; checked_by: string }[];
  return {
    post,
    photos: photos.map((p, i) => ({ ...p, url: signed.data?.[i]?.signedUrl ?? null })),
    choices,
    sentences,
    checklist: checks,
    needs_review: needsReview,
    can_approve:
      post.status === "draft" &&
      live.length > 0 &&
      needsReview === 0 &&
      live.every((s) => s.verdict === "match") &&
      !checks.some((c) => c.checked_by === "code" && c.status === "fail"),
  };
}

// ───────── 02 사진·메모 ─────────

export async function createPost(memo: string, isEval = false) {
  const row = must(await db().from("posts").insert({ memo: memo.trim(), is_eval: isEval }).select("id").single()) as {
    id: string;
  };
  return { post_id: row.id };
}

/** POST /api/posts/:id/photos — 브라우저에서 가린 이미지만 받는다. masked !== true면 400. */
export async function addPhoto(postId: string, file: File, masked: boolean) {
  if (!masked) throw new ApiError(400, "not_masked", "민감정보를 가린 사진만 올릴 수 있습니다. (masked=true 필요)");
  const post = await getPostRow(postId);
  requireDraft(post);
  if (!(IMAGE_TYPES as readonly string[]).includes(file.type)) {
    throw new ApiError(400, "invalid_image", "PNG, JPEG, WEBP, GIF 이미지만 올릴 수 있습니다.");
  }
  if (file.size > MAX_IMAGE_BYTES) throw new ApiError(413, "file_too_large", "사진은 5MB 이하만 올릴 수 있습니다.");

  const path = `${postId}/${crypto.randomUUID()}.${file.type.split("/")[1]}`;
  const up = await db().storage.from("photos").upload(path, new Uint8Array(await file.arrayBuffer()), { contentType: file.type });
  if (up.error) throw new ApiError(500, "upload_failed", up.error.message);
  const photo = must(
    await db().from("photos").insert({ post_id: postId, storage_path: path, masked: true }).select("*").single(),
  ) as Photo;
  return { photo };
}

// ───────── 03 카드 고르기 ─────────

/** POST /api/posts/:id/classify (6-2) — 사진 분류 + 카드 3장 추천 + 가이드라인 순서 배치. */
export async function classifyPost(postId: string) {
  const post = await getPostRow(postId);
  requireDraft(post);
  const photos = await getPhotos(postId);
  if (photos.length === 0) throw new ApiError(409, "no_photos", "사진을 먼저 올려야 합니다.");
  if (photos.some((p) => !p.masked)) throw new ApiError(409, "not_masked", "가리지 않은 사진이 있습니다.");
  const cards = must(
    await db().from("cards").select("*").eq("status", "active").order("priority_score", { ascending: false }).order("code"),
  ) as Card[];
  if (cards.length === 0) throw new ApiError(409, "no_cards", "차별점 카드를 먼저 만들어야 합니다.");

  const inputs: PhotoInput[] = [];
  for (const p of photos) {
    const file = await db().storage.from("photos").download(p.storage_path);
    if (file.error || !file.data) throw new ApiError(500, "download_failed", "사진을 불러오지 못했습니다.");
    const ext = p.storage_path.split(".").pop();
    inputs.push({
      id: p.id,
      mediaType: (IMAGE_TYPES.find((t) => t.endsWith(`/${ext}`)) ?? "image/png") as PhotoInput["mediaType"],
      base64: Buffer.from(await file.data.arrayBuffer()).toString("base64"),
    });
  }

  const result = await classifyPhotos({ postId, memo: post.memo, photos: inputs, cards });

  // 후처리: 가이드라인 순서(화면 캡처 5종 → 설치 현장 → 사용 장면)
  const order = SCREEN_ORDER as readonly string[];
  const classified = photos.map((p, uploaded) => {
    const r = result.photos.find((x) => x.photo_id === p.id);
    const kind = r?.kind ?? null;
    const screen_type = kind === "screen" ? (r?.screen_type ?? null) : null;
    const rank =
      kind === "screen" ? (screen_type ? order.indexOf(screen_type) : order.length) : kind === "site" ? 10 : kind === "scene" ? 11 : 12;
    return { photo: p, r, kind, screen_type, rank, uploaded };
  });
  classified.sort((a, b) => a.rank - b.rank || a.uploaded - b.uploaded);

  const byCode = new Map(cards.map((c) => [c.code, c]));
  const choiceRows: object[] = [];
  for (const [index, c] of classified.entries()) {
    must(
      await db()
        .from("photos")
        .update({ kind: c.kind, screen_type: c.screen_type, description: c.r?.description ?? null, order_index: index })
        .eq("id", c.photo.id),
    );
    // 존재하지 않는 code는 버리고 priority_score 순으로 3장을 채운다
    const picked: { card: Card; reason: string | null }[] = [];
    for (const rec of c.r?.recommended_cards ?? []) {
      const card = byCode.get(rec.code);
      if (card && !picked.some((x) => x.card.id === card.id) && picked.length < 3) picked.push({ card, reason: rec.reason });
    }
    for (const card of cards) {
      if (picked.length >= 3) break;
      if (!picked.some((x) => x.card.id === card.id)) picked.push({ card, reason: null });
    }
    picked.forEach((x, i) =>
      choiceRows.push({ post_id: postId, photo_id: c.photo.id, card_id: x.card.id, rank: i + 1, reason: x.reason, selected: false }),
    );
  }
  must(await db().from("photo_card_choices").delete().eq("post_id", postId));
  must(await db().from("photo_card_choices").insert(choiceRows));
  await addInjectionNotes(post, result.injection_notes);

  const present = new Set(classified.map((c) => c.screen_type));
  return {
    photos: await getPhotos(postId),
    choices: await getChoices(postId),
    missing_screen_types: SCREEN_ORDER.filter((t) => !present.has(t)),
    injection_notes: result.injection_notes,
  };
}

/** PATCH /api/posts/:id/choices — 카드 선택/해제. 사진마다 1장 이상 골라야 ready. */
export async function setChoice(postId: string, photoId: string, cardId: string, selected: boolean) {
  requireDraft(await getPostRow(postId));
  const updated = must(
    await db()
      .from("photo_card_choices")
      .update({ selected })
      .eq("post_id", postId)
      .eq("photo_id", photoId)
      .eq("card_id", cardId)
      .select("card_id"),
  ) as unknown[];
  if (updated.length === 0) throw new ApiError(404, "not_found", "이 사진의 추천 카드가 아닙니다.");
  const [choices, photos] = await Promise.all([getChoices(postId), getPhotos(postId)]);
  return {
    choices,
    ready: photos.length > 0 && photos.every((p) => choices.some((c) => c.photo_id === p.id && c.selected)),
  };
}

// ───────── 04 초안 ─────────

/** 8장 코드 검사를 다시 돌려 checklist_results에 저장한다(글 쓰기 직후 + 문장 수정 후마다). */
export async function refreshCodeChecks(postId: string) {
  const [post, sentences, photos, guideline, published, rules] = await Promise.all([
    getPostRow(postId),
    getSentences(postId),
    getPhotos(postId),
    getGuideline(),
    db().from("posts").select("id").eq("status", "published").eq("is_eval", false).neq("id", postId),
    db().from("learned_rules").select("value").eq("kind", "banned_phrase").eq("active", true),
  ]);
  const pastIds = (must(published) as { id: string }[]).map((p) => p.id);
  const past = pastIds.length
    ? (must(await db().from("sentences").select("text").in("post_id", pastIds).eq("deleted", false)) as { text: string }[])
    : [];
  const results = runCodeChecks({
    title: post.title,
    sentences,
    photos,
    guideline,
    pastSentences: past.map((s) => s.text),
    bannedPhrases: (must(rules) as { value: { phrase?: string } }[]).map((r) => r.value.phrase ?? "").filter(Boolean),
  });
  must(
    await db()
      .from("checklist_results")
      .upsert(results.map((r) => ({ ...r, post_id: postId, checked_by: "code" })), { onConflict: "post_id,item_key" }),
  );
  return results;
}

/** POST /api/posts/:id/write (6-3) — 고른 카드·사진·메모만으로 5단계 초안. 재작성은 글당 1회. */
export async function writePost(postId: string, rewrite: boolean) {
  const post = await getPostRow(postId);
  requireDraft(post);
  const [photos, choices, existing, guideline, rules] = await Promise.all([
    getPhotos(postId),
    getChoices(postId),
    getSentences(postId),
    getGuideline(),
    db().from("learned_rules").select("kind, value").eq("active", true),
  ]);
  if (photos.length === 0 || !photos.every((p) => choices.some((c) => c.photo_id === p.id && c.selected))) {
    throw new ApiError(409, "choices_incomplete", "사진마다 카드를 1장 이상 골라야 합니다.");
  }
  if (existing.length > 0) {
    if (!rewrite) throw new ApiError(409, "already_written", "이미 초안이 있습니다. 다시 쓰려면 rewrite: true로 요청하세요.");
    if (post.rewrite_count >= 1) throw new ApiError(409, "rewrite_limit", "재작성은 글당 1회까지입니다.");
  }

  const selected = new Map<string, Card>();
  for (const c of choices) if (c.selected) selected.set(c.card.code, c.card);
  const cards = [...selected.values()].sort((a, b) => b.priority_score - a.priority_score || a.code.localeCompare(b.code));
  const ruleRows = must(rules) as { kind: string; value: { phrase?: string; label?: string } }[];

  const draft = await writeDraft({
    postId,
    memo: post.memo,
    guideline,
    cards,
    photos: photos.map((p) => ({ id: p.id, kind: p.kind, screen_type: p.screen_type, description: p.description ?? "" })),
    rules: {
      banned_phrases: ruleRows.filter((r) => r.kind === "banned_phrase").map((r) => r.value.phrase ?? "").filter(Boolean),
      preferred_intros: ruleRows.filter((r) => r.kind === "preferred_intro").map((r) => r.value.label ?? "").filter(Boolean),
    },
  });

  // 후처리: 꼬리표가 고른 카드·사진·memo가 아니면 그 문장은 unsupported로 저장한다
  const photoIds = new Set(photos.map((p) => p.id));
  const rows: object[] = [];
  for (const section of [...draft.sections].sort((a, b) => a.section_no - b.section_no)) {
    if (section.section_no < 1 || section.section_no > 5) continue;
    for (const s of section.sentences) {
      if (!s.text.trim()) continue;
      const valid =
        (s.source_type === "card" && selected.has(s.source_ref)) ||
        (s.source_type === "photo" && photoIds.has(s.source_ref)) ||
        (s.source_type === "memo" && s.source_ref === "memo");
      rows.push({
        post_id: postId,
        section_no: section.section_no,
        order_no: rows.length,
        text: s.text.trim(),
        source_type: s.source_type,
        source_ref: s.source_ref || "unknown",
        verdict: valid ? "pending" : "unsupported",
        verdict_reason: valid ? null : "출처 꼬리표가 고른 카드·사진·메모에 없습니다.",
      });
    }
  }
  if (rows.length === 0) throw new ApiError(502, "ai_bad_output", "초안에 문장이 없습니다.");

  const tags = [...guideline.hashtags, ...draft.hashtags.map((h) => (h.startsWith("#") ? h : `#${h}`))];
  must(await db().from("sentences").delete().eq("post_id", postId));
  must(await db().from("checklist_results").delete().eq("post_id", postId));
  must(await db().from("sentences").insert(rows));
  must(
    await db()
      .from("posts")
      .update({
        title: draft.title.trim(),
        hashtags: [...new Set(tags.map((t) => t.trim()).filter(Boolean))],
        omitted_missions: draft.omitted_missions,
        rewrite_count: post.rewrite_count + (existing.length > 0 ? 1 : 0),
      })
      .eq("id", postId),
  );
  await addInjectionNotes(post, draft.injection_notes);
  await refreshCodeChecks(postId);
  return getPost(postId);
}

/**
 * POST /api/posts/:id/verify (6-4) — 글을 쓰지 않은 별도 호출로 원문 대조.
 * onlyIds를 주면 그 문장만 재검증한다(문장 수정 후).
 */
export async function verifyPost(postId: string, onlyIds?: string[]) {
  const post = await getPostRow(postId);
  requireDraft(post);
  const all = (await getSentences(postId)).filter((s) => !s.deleted);
  const targets = onlyIds ? all.filter((s) => onlyIds.includes(s.id)) : all;
  if (targets.length === 0) {
    if (onlyIds) return getPost(postId);
    throw new ApiError(409, "no_sentences", "검증할 문장이 없습니다. 먼저 초안을 써야 합니다.");
  }

  const [photos, cardRows, materialRows] = await Promise.all([
    getPhotos(postId),
    db().from("cards").select("code, citations"),
    db().from("materials").select("id, name"),
  ]);
  const cards = new Map((must(cardRows) as Pick<Card, "code" | "citations">[]).map((c) => [c.code, c]));
  const materialName = new Map((must(materialRows) as { id: string; name: string }[]).map((m) => [m.id, m.name]));
  const photoIds = new Set(photos.map((p) => p.id));

  // 근거 쪽 모으기: 카드의 인용 쪽 + (꼬리표가 틀렸을 때를 대비한) 하이브리드 검색 상위 5쪽
  const pages = new Map<string, VerifyPage>();
  const addPage = (material_id: string, page_no: number, text: string) =>
    pages.set(`${material_id}:${page_no}`, { material_id, material: materialName.get(material_id) ?? "자료", page_no, text });

  const needSearch = targets.filter(
    (s) => s.source_type === "card" || !(s.source_ref === "memo" || photoIds.has(s.source_ref)),
  );
  if (needSearch.length) {
    const vectors = await embed(needSearch.map((s) => s.text), "query");
    for (const [i, s] of needSearch.entries()) {
      for (const p of await matchPages(vectors[i], s.text, 5)) addPage(p.material_id, p.page_no, p.text);
    }
    const cited = new Map<string, Set<number>>();
    for (const s of needSearch) {
      for (const c of cards.get(s.source_ref)?.citations ?? []) {
        cited.set(c.material_id, (cited.get(c.material_id) ?? new Set()).add(c.page_no));
      }
    }
    for (const [materialId, pageNos] of cited) {
      const rows = must(
        await db()
          .from("material_pages")
          .select("material_id, page_no, text")
          .eq("material_id", materialId)
          .eq("quarantined", false)
          .in("page_no", [...pageNos]),
      ) as { material_id: string; page_no: number; text: string }[];
      for (const r of rows) addPage(r.material_id, r.page_no, r.text);
    }
  }

  const sources = {
    pages: [...pages.values()],
    photos: photos.map((p) => ({ id: p.id, description: p.description ?? "" })),
    memo: post.memo,
  };
  const result = await verifySentences({ postId, full: !onlyIds, sentences: targets, ...sources });

  for (const s of targets) {
    const r = result.results.find((x) => x.sentence_id === s.id);
    const checked = r
      ? checkEvidence(r, sources)
      : { verdict: "unsupported" as const, reason: "검증 결과가 돌아오지 않았습니다.", evidence: [] };
    must(
      await db()
        .from("sentences")
        .update({
          verdict: checked.verdict,
          verdict_reason: checked.reason,
          evidence: checked.evidence,
          suggestion: checked.verdict === "match" ? null : (r?.suggestion ?? null),
        })
        .eq("id", s.id),
    );
  }

  const aiRows: object[] = [];
  if (result.ai_checklist) {
    const c = result.ai_checklist;
    aiRows.push(
      { post_id: postId, item_key: "review_format", status: c.review_format, checked_by: "ai", detail: c.notes },
      { post_id: postId, item_key: "conclusion_message", status: c.conclusion_message, checked_by: "ai", detail: c.notes },
    );
  }
  await saveReviewCount(postId, aiRows);
  await addInjectionNotes(post, result.injection_notes);
  await refreshCodeChecks(postId);
  return getPost(postId);
}

/** AI 판정 항목 unsupported_sentences(확인 필요 개수)를 최신 상태로 저장한다. */
async function saveReviewCount(postId: string, extra: object[] = []) {
  const live = (await getSentences(postId)).filter((s) => !s.deleted);
  const n = live.filter((s) => s.verdict === "exaggeration" || s.verdict === "unsupported").length;
  must(
    await db()
      .from("checklist_results")
      .upsert(
        [
          ...extra,
          {
            post_id: postId,
            item_key: "unsupported_sentences",
            status: n === 0 ? "pass" : "fail",
            checked_by: "ai",
            detail: n === 0 ? null : `확인 필요 ${n}건 남음`,
          },
        ],
        { onConflict: "post_id,item_key" },
      ),
  );
}

/** PATCH /api/sentences/:id — 수정·삭제·제안 수락. edits에 기록하고 그 문장만 재검증한다. */
export async function patchSentence(
  sentenceId: string,
  body: { text?: string; deleted?: true; accept_suggestion?: true },
) {
  const sentence = must(await db().from("sentences").select("*").eq("id", sentenceId).maybeSingle()) as Sentence | null;
  if (!sentence) throw new ApiError(404, "not_found", "문장을 찾을 수 없습니다.");
  requireDraft(await getPostRow(sentence.post_id));
  if (sentence.deleted) throw new ApiError(409, "already_deleted", "이미 지운 문장입니다.");
  const postId = sentence.post_id;

  if (body.deleted) {
    must(await db().from("sentences").update({ deleted: true }).eq("id", sentenceId));
    must(await db().from("edits").insert({ post_id: postId, sentence_id: sentenceId, kind: "delete", before: sentence.text, after: null }));
    await saveReviewCount(postId);
    await refreshCodeChecks(postId);
    return getPost(postId);
  }

  const text = (body.accept_suggestion ? sentence.suggestion : body.text)?.trim();
  if (!text) {
    throw new ApiError(400, "invalid_body", body.accept_suggestion ? "수락할 제안 문장이 없습니다." : "text가 비어 있습니다.");
  }
  if (text !== sentence.text) {
    must(
      await db()
        .from("sentences")
        .update({ text, verdict: "pending", verdict_reason: null, evidence: [], suggestion: null })
        .eq("id", sentenceId),
    );
    must(await db().from("edits").insert({ post_id: postId, sentence_id: sentenceId, kind: "edit", before: sentence.text, after: text }));
  }
  return verifyPost(postId, [sentenceId]);
}

// ───────── 05 승인·복사 ─────────

/** POST /api/posts/:id/approve — 서버 검사. 확인 필요 1건 이상이거나 코드 검사 fail이면 409. */
export async function approvePost(postId: string) {
  const post = await getPostRow(postId);
  if (post.status !== "draft") return { post };
  const live = (await getSentences(postId)).filter((s) => !s.deleted);
  if (live.length === 0) throw new ApiError(409, "no_sentences", "승인할 문장이 없습니다.");
  const flagged = live.filter((s) => s.verdict === "exaggeration" || s.verdict === "unsupported").length;
  if (flagged > 0) throw new ApiError(409, "needs_review", `확인 필요 ${flagged}건이 남아 있어 승인할 수 없습니다.`);
  const pending = live.filter((s) => s.verdict === "pending").length;
  if (pending > 0) throw new ApiError(409, "not_verified", `원문 대조를 거치지 않은 문장이 ${pending}건 있습니다.`);
  const failed = (await refreshCodeChecks(postId)).filter((c) => c.status === "fail");
  if (failed.length > 0) {
    throw new ApiError(409, "checks_failed", `코드 검사 실패: ${failed.map((c) => `${c.item_key}(${c.detail})`).join("; ")}`);
  }
  const updated = must(
    await db().from("posts").update({ status: "approved", approved_at: new Date().toISOString() }).eq("id", postId).select("*").single(),
  );
  return { post: updated };
}

/** GET /api/posts/:id/export — 근거 표시 없는 블로그용 본문. approved가 아니면 409. */
export async function exportPost(postId: string) {
  const post = await getPostRow(postId);
  if (post.status === "draft") throw new ApiError(409, "not_approved", "승인된 글만 복사할 수 있습니다.");
  const [sentences, guideline] = await Promise.all([getSentences(postId), getGuideline()]);
  return buildExport({
    title: post.title,
    sentences,
    footer_lines: guideline.footer_lines,
    hashtags: post.hashtags ?? guideline.hashtags,
  });
}

/** PATCH /api/posts/:id — 게시 주소 저장, status → published. */
export async function publishPost(postId: string, publishedUrl: string) {
  const post = await getPostRow(postId);
  if (post.status === "draft") throw new ApiError(409, "not_approved", "승인된 글만 게시 주소를 저장할 수 있습니다.");
  const updated = must(
    await db()
      .from("posts")
      .update({ status: "published", published_url: publishedUrl, published_at: post.published_at ?? new Date().toISOString() })
      .eq("id", postId)
      .select("*")
      .single(),
  );
  return { post: updated };
}

/** POST /api/posts/:id/reactions — 게시 후 반응 직접 입력. */
export async function saveReactions(
  postId: string,
  r: { views: number; likes: number; comments: number; inquiries: number },
) {
  const post = await getPostRow(postId);
  if (post.status !== "published") throw new ApiError(409, "not_published", "게시한 글에만 반응을 입력할 수 있습니다.");
  const row = must(
    await db()
      .from("reactions")
      .upsert({ post_id: postId, ...r, recorded_at: new Date().toISOString() }, { onConflict: "post_id" })
      .select("*")
      .single(),
  );
  return { reactions: row };
}
