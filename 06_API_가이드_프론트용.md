# 06. API 가이드 (프론트용)

> 백엔드 API가 `main`에 구현돼 있습니다. 화면을 붙일 때 이 문서만 보면 되도록 정리했습니다.
> 화면별 규칙은 `05_개발명세서.md` 9장, 서버 코드는 `app/api/`와 `lib/services/`에 있습니다.

## 1. 공통

- **실행**: `npm install` → `.env.example`을 `.env.local`로 복사해 키 입력 → `npm run dev`
- **DB**: `supabase/migrations/0001_init.sql`, `0002_seed_guideline.sql`을 Supabase에 적용해야 합니다.
- **인증**: 모든 라우트는 로그인 필수입니다. Supabase 세션 쿠키(`@supabase/ssr`)가 있으면 그대로 통과하고, 없으면 `Authorization: Bearer <access_token>` 헤더를 붙입니다. 미로그인 401, 허용 계정이 아니면 403.
- **응답**: 모두 JSON. 오류는 항상 `{ "error": { "code": "...", "message": "한국어 안내문" } }` 형식이라 `message`를 그대로 화면에 띄워도 됩니다.
- **AI 호출 라우트는 느립니다**(수십 초~수 분): `cards/generate`, `classify`, `write`, `verify`, `PATCH sentences`, `eval/run`. 로딩 상태가 필요합니다.
- **AI가 만든 글자는 텍스트로만 렌더링**합니다(HTML로 해석 금지 — 인젝션 방어 3층).

### 공통 오류 코드

| 상태 | code | 뜻 |
|---|---|---|
| 400 | `invalid_body`, `invalid_json`, `invalid_id`, `invalid_form` | 요청 형식 오류 |
| 401 / 403 | `unauthorized` / `forbidden` | 로그인 필요 / 허용되지 않은 계정 |
| 404 | `not_found` | 대상 없음 |
| 409 | `not_draft` | 승인된 글은 수정 불가 |
| 429 | `cost_cap_reached` | 글 1건 AI 비용 상한($1) 도달 → 추가 호출 차단. 화면에 알림 |
| 429 / 502 / 503 | `ai_rate_limited` / `ai_error`, `ai_refusal`, `ai_bad_output`, `ai_truncated` / `ai_unreachable` | AI 호출 실패. 다시 시도 안내 |

## 2. 화면별 API

### 01 자료·카드 (`/materials`)

| 메서드·경로 | 입력 | 출력 |
|---|---|---|
| `GET /api/materials` | — | `{ materials: [{ id, name, source_file, page_count, status, indexed_pages, quarantined_pages, injection_findings: [...] }], pending_findings: number, conflicts: [{ id, text }] }` |
| `POST /api/materials` | multipart: `file`(PDF, 50MB 이하), `name?`, `exclude_pages?`(예: `"14,15"`) | `{ material_id, status: "scanning" }` |
| `PATCH /api/injection-findings/:id` | `{ status: "excluded" \| "allowed" }` | `{ finding, quarantined }` |
| `POST /api/cards/generate` | `{ replace: boolean }` | `{ cards: [...], conflicts: string[] }` |
| `GET /api/cards` | — | `{ cards: [{ id, code, claim, benefit, condition, citations: [{ material_id, page_no, cited_text }], priority_score }] }` |

- 자료 `status`: `scanning`(검사 중) → `ready` / `failed`. 등록 직후에는 `scanning`이라 `GET /api/materials`를 다시 불러 확인합니다.
- `injection_findings[].status`가 `pending`인 것이 있으면 `cards/generate`가 **409 `pending_findings`**입니다. 먼저 "계속 제외 / 허용"을 처리하게 하세요.
- `conflicts`는 자료끼리 내용이 다른 항목(`[CONFLICT]`) — 경고 박스로 보여 줍니다.
- 카드에 `condition`이 있으면 "조건부" 칩.

### 02 사진·메모 (`/posts/new` → `/posts/[id]/photos`)

| 메서드·경로 | 입력 | 출력 |
|---|---|---|
| `POST /api/posts` | `{ memo }` (1~2000자) | `{ post_id }` |
| `POST /api/posts/:id/photos` | multipart: `file`(PNG/JPEG/WEBP/GIF, 5MB 이하), `masked=true` | `{ photo }` |

- **브라우저에서 가린(캔버스로 합성한) 이미지만** 올립니다. `masked`가 `"true"`가 아니면 **400 `not_masked`**. 원본 이미지는 서버로 보내지 않습니다.
- 전화번호 자동 가리기(OCR)와 수동 박스는 프론트 몫입니다(`lib/mask/ocrMask.ts`, 명세 9장 02 화면의 정규식 참고).

### 03 카드 고르기 (`/posts/[id]/cards`)

| 메서드·경로 | 입력 | 출력 |
|---|---|---|
| `POST /api/posts/:id/classify` | — | `{ photos, choices, missing_screen_types: string[], injection_notes: string[] }` |
| `PATCH /api/posts/:id/choices` | `{ photo_id, card_id, selected?: boolean }` (기본 `true`, `false`면 해제) | `{ choices, ready: boolean }` |

- `photos[]`: `{ id, kind: "site"|"screen"|"scene", screen_type, description, order_index }` — `order_index`가 가이드라인 순서입니다.
- `choices[]`: `{ photo_id, card_id, rank: 1~3, reason, selected, card: {...} }` — 사진마다 추천 카드 3장.
- `missing_screen_types`: 빠진 화면 캡처 종류(`phone_call`, `voip_list`, `ai_summary`, `staff_stats`, `report`) → 경고 표시.
- `ready`가 `true`(사진마다 1장 이상 선택)일 때만 "초안 쓰기" 버튼을 켭니다.
- 오류: 409 `no_photos`, `no_cards`(카드를 먼저 만들어야 함).

### 04 초안 검토 (`/posts/[id]/review`)

| 메서드·경로 | 입력 | 출력 |
|---|---|---|
| `POST /api/posts/:id/write` | `{ rewrite?: boolean }` | 글 전체 상태(아래) |
| `POST /api/posts/:id/verify` | — | 글 전체 상태 |
| `PATCH /api/sentences/:id` | `{ text }` 또는 `{ deleted: true }` 또는 `{ accept_suggestion: true }` (셋 중 하나만) | 글 전체 상태 |
| `GET /api/posts/:id` | — | 글 전체 상태 |

**글 전체 상태** (네 라우트가 같은 모양을 돌려줍니다. 응답으로 화면을 통째로 갱신하면 됩니다):

```jsonc
{
  "post": { "id", "title", "memo", "status": "draft|approved|published", "hashtags", "omitted_missions": [{ "no", "reason" }], "injection_notes": [], "rewrite_count", "published_url" },
  "photos": [{ "id", "kind", "screen_type", "description", "order_index", "url" }],   // url = 서명 URL(10분)
  "choices": [ /* 03과 같음 */ ],
  "sentences": [{
    "id", "section_no": 1, "order_no": 0, "text",
    "source_type": "card|photo|memo", "source_ref": "C-01 | 사진 id | memo",
    "verdict": "pending|match|exaggeration|unsupported",
    "verdict_reason", "evidence": [{ "material", "page_no", "quote" }], "suggestion", "deleted"
  }],
  "checklist": [{ "item_key", "status": "pass|fail|omitted", "checked_by": "code|ai", "detail" }],
  "needs_review": 2,       // 확인 필요 문장 수
  "can_approve": false     // true일 때만 승인·복사 버튼 활성화
}
```

- 흐름: `write` → 곧바로 `verify` 호출. `write` 직후 문장은 `pending`입니다.
- 칩 매핑: `match` → 일치 / `exaggeration`·`unsupported` → 확인 필요 / `pending` → 검증 전. `deleted: true`인 문장은 숨깁니다.
- 우측 패널: 선택한 문장의 `verdict_reason`, `evidence`(자료명·쪽·인용 원문), `suggestion`("제안 문장으로 바꾸기" → `{ accept_suggestion: true }`).
- 문장을 수정·제안 수락하면 **서버가 그 문장만 재검증**하고 돌려줍니다(AI 호출이라 몇 초 걸림). 삭제는 즉시.
- 하단 바: `needs_review > 0`이면 "확인 필요 N건 남음" + 버튼 비활성화.
- `post.injection_notes`가 비어 있지 않으면 상단에 "입력 데이터에서 지시문 발견" 알림.
- `post.omitted_missions`: 근거가 없어 뺀 강조 항목 → 점검표에 "조건부" 칩.
- 재작성(`rewrite: true`)은 글당 1회. 오류: 409 `choices_incomplete`, `already_written`, `rewrite_limit`.
- 점검표 `item_key`: 코드 검사 `required_keywords`, `title_phrases`, `footer`, `image_order`, `no_duplicates`, `banned_phrases`, `all_sourced` / AI 판정 `review_format`, `conclusion_message`, `unsupported_sentences`.

### 05 승인·복사 (`/posts/[id]/done`)

| 메서드·경로 | 입력 | 출력 |
|---|---|---|
| `POST /api/posts/:id/approve` | — | `{ post }` |
| `GET /api/posts/:id/export` | — | `{ title, body, footer, hashtags, text }` |
| `PATCH /api/posts/:id` | `{ published_url }` (http/https) | `{ post }` (status → `published`) |

- 승인은 서버에서도 막습니다: 409 `needs_review`(확인 필요 남음), `not_verified`(검증 안 한 문장), `checks_failed`(코드 검사 실패), `no_sentences`.
- "블로그용 복사" = `export`의 `text`를 클립보드로. 근거 표시 없이 제목·본문·하단 정보·해시태그만 들어 있습니다. 승인 전이면 409 `not_approved`.

### 06 반응·학습 (`/learning`)

| 메서드·경로 | 입력 | 출력 |
|---|---|---|
| `GET /api/posts` | — | `{ posts: [{ ...post, reactions }] }` |
| `POST /api/posts/:id/reactions` | `{ views, likes, comments, inquiries }` (0 이상 정수) | `{ reactions }` |
| `POST /api/learning/recompute` | — | `{ rules }` |
| `GET /api/learning/rules` | — | `{ rules: [{ id, kind, value, evidence_count, strength: "weak"\|"ok", active }] }` |
| `PATCH /api/learning/rules/:id` | `{ active: boolean }` | `{ rule }` |

- 반응은 게시된 글(`published`)에만 입력 가능 — 아니면 409 `not_published`.
- `kind`별 `value`: `card_order` → `{ order: [{ code, score }] }` / `banned_phrase` → `{ phrase }` / `preferred_intro` → `{ type, label }`.
- `strength: "weak"`면 "약한 근거" 칩.

### 07 홈 (`/`)

전용 집계 API는 없습니다. `GET /api/posts`(글·게시일·반응), `GET /api/materials`, `GET /api/cards`, `GET /api/learning/rules`로 계산합니다. 필요한 집계가 있으면 말해 주세요.

### 08 신뢰도 (`/trust`)

| 메서드·경로 | 입력 | 출력 |
|---|---|---|
| `GET /api/eval/run` | — | `{ runs: [...] }` (최근 10건) |
| `POST /api/eval/run` | — | `{ run: { results, page_accuracy, trap_detected, trap_total, injection_detected, injection_total, avg_cost_usd } }` |

- 실행은 비용이 드니 확인 대화상자 뒤에 호출합니다. 평가 사례 파일이 없으면 409 `no_eval_cases`.

## 3. 알아 둘 점 (명세와 다른 부분·제약)

- **DB 추가분**: `ai_calls`, `card_conflicts`, `app_owner` 테이블과 `posts.rewrite_count`·`is_eval`·`injection_notes`, `materials.status` 등을 추가했습니다. SQL에 `[추가]`로 표시해 뒀습니다.
- **명세에 없던 라우트**: `GET /api/posts`, `GET /api/posts/:id`, `GET /api/learning/rules`, `PATCH /api/learning/rules/:id`, `GET /api/eval/run`.
- **흰 글씨 탐지 없음**: 웹 등록은 1pt 이하 글자와 지시문 판별(Gemini)만 합니다. OCR 비교는 구현하지 않았습니다.
- **AI는 전부 Gemini**: 명세의 Claude·Voyage 대신 Gemini(`@google/genai`)를 씁니다. 키는 `GEMINI_API_KEY` 하나입니다. API 요청·응답 형식은 바뀌지 않았습니다.
- **카드 쪽 번호는 코드가 확인**: Claude Citations 대신, AI가 낸 인용문이 쪽 원문에 글자 그대로 있는지 코드가 찾아 그 쪽 번호만 저장합니다. 원문에서 못 찾은 인용과 인용 없는 카드는 버립니다.
- **카드 생성은 쪽 텍스트만 사용**: PDF의 텍스트 레이어만 넣습니다. 그림 안에만 있는 글자는 카드 근거가 되지 못합니다.
- **회사소개서 등록 불가**: `티링크_회사소개서.pdf`가 237MB라 등록 상한 50MB에 걸립니다. 압축하거나 로컬 등록 스크립트가 필요합니다. (Vercel 배포에서는 요청 본문 한도가 더 작아 업로드 가능한 크기가 더 줄어듭니다.)
- **PPTX 업로드 미지원**: 웹은 PDF만 받습니다. PPTX는 PDF로 바꿔서 올립니다.
- **검색 함수**: `match_pages`의 부분 일치를 `similarity` 대신 `word_similarity`로 바꿨습니다.
- **모델**: 기본값은 `gemini-3.8-flash`(카드·검증·분류·글 쓰기), `gemini-3.5-flash-lite`(지시문 판별), 임베딩 `gemini-embedding-001`(1024차원). `.env.local`의 `GEMINI_MODEL_*`로 바꿀 수 있습니다.
- **비용 상한은 단가를 넣어야 동작**: `GEMINI_PRICE_INPUT_PER_MTOK`·`GEMINI_PRICE_OUTPUT_PER_MTOK`를 비워 두면 비용이 0으로 기록되고 `cost_cap_reached`가 걸리지 않습니다.
- **평가 사례 없음**: `/api/eval/run`은 `eval/cases/E-xx/`가 있어야 동작하는데 아직 사례 파일이 없습니다. `expected.json` 형식은 `lib/eval.ts` 상단 주석에 있습니다.
- **아직 없는 것**: `scripts/ingest.ts`(PPTX 변환·xlsx 파싱), 화면 8개, 로그인 화면.
- **미검증**: 타입 검사·빌드·단위 테스트는 통과했지만 실제 Supabase·Gemini에 연결해 돌려 보지는 않았습니다. 붙이다가 이상한 응답이 나오면 바로 알려 주세요.
