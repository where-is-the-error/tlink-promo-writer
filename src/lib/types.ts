/**
 * 프론트엔드 ↔ API 데이터 계약.
 * API 담당은 이 타입 그대로 JSON(camelCase)을 돌려주면 됩니다.
 * 엔드포인트 목록은 docs/API_CONTRACT.md, 동작 규칙은 05_개발명세서.md 5~6장.
 */

export type Verdict = 'pending' | 'match' | 'exaggeration' | 'unsupported';
export type SourceType = 'card' | 'photo' | 'memo';
export type PhotoKind = 'site' | 'screen' | 'scene';
export type ScreenType = 'phone_call' | 'voip_list' | 'ai_summary' | 'staff_stats' | 'report';
export type PostStatus = 'draft' | 'approved' | 'published';
export type CheckStatus = 'pass' | 'fail' | 'omitted';

export type Citation = {
  materialId: string;
  materialName: string;
  pageNo: number;
  citedText: string;
}

export type Card = {
  id: string;
  code: string; // 'C-01'
  claim: string;
  benefit: string;
  condition: string | null;
  citations: Citation[];
  priorityScore: number;
}

export type Material = {
  id: string;
  name: string;
  sourceFile: string;
  pageCount: number;
  indexedPages: number;
  status: 'scanning' | 'ready';
}

export type InjectionFinding = {
  id: string;
  materialId: string;
  materialName: string;
  pageNo: number;
  snippet: string;
  detector: 'invisible_text' | 'instruction_like' | 'hidden_slide';
  status: 'pending' | 'excluded' | 'allowed';
}

export type CardConflict = {
  topic: string;
  detail: string;
}

export type MaterialsOverview = {
  materials: Material[];
  findings: InjectionFinding[];
  conflicts: CardConflict[];
  totalPages: number;
  indexedPages: number;
}

export type Photo = {
  id: string;
  url: string; // 서명 URL (가린 이미지)
  fileName: string;
  masked: boolean;
  kind: PhotoKind | null;
  screenType: ScreenType | null;
  description: string | null;
  orderIndex: number;
}

export type CardChoice = {
  photoId: string;
  cardId: string;
  rank: number; // 1~3
  reason: string;
  selected: boolean;
}

export type Evidence = {
  materialName: string;
  pageNo: number;
  quote: string;
}

export type Sentence = {
  id: string;
  sectionNo: 1 | 2 | 3 | 4 | 5;
  orderNo: number;
  text: string;
  sourceType: SourceType;
  sourceRef: string; // 'C-01' | photoId | 'memo'
  verdict: Verdict;
  verdictReason: string | null;
  evidence: Evidence[];
  suggestion: string | null;
  deleted: boolean;
}

export type ChecklistItem = {
  itemKey: string;
  label: string;
  status: CheckStatus;
  checkedBy: 'code' | 'ai';
  detail: string | null;
}

export type OmittedMission = {
  no: number;
  text: string;
  reason: string;
}

export type Post = {
  id: string;
  title: string | null;
  memo: string;
  status: PostStatus;
  hashtags: string[];
  footerLines: string[];
  omittedMissions: OmittedMission[];
  injectionNotes: string[];
  publishedUrl: string | null;
  createdAt: string;
  approvedAt: string | null;
  publishedAt: string | null;
  costUsd: number;
}

/** GET /api/posts/:id 응답: 글 한 건의 전체 상태 */
export type PostDetail = {
  post: Post;
  photos: Photo[];
  choices: CardChoice[];
  cards: Card[]; // 추천·선택에 등장하는 카드
  missingScreenTypes: ScreenType[];
  sentences: Sentence[];
  checklist: ChecklistItem[];
}

export type PostSummary = {
  id: string;
  title: string;
  status: PostStatus;
  unresolvedCount: number;
  views: number | null;
  updatedAt: string;
}

export type LearnedRule = {
  id: string;
  kind: 'card_order' | 'banned_phrase' | 'preferred_intro';
  title: string;
  description: string;
  strength: 'weak' | 'ok';
  active: boolean;
}

export type Dashboard = {
  monthPublished: number;
  lastMonthPublished: number;
  avgWriteMinutes: number | null;
  baselineWriteMinutes: number;
  caughtSentences: number;
  daysSinceLastPost: number | null;
  recentPosts: PostSummary[];
  knowledgeBase: {materials: number; totalPages: number; indexedPages: number; cards: number; quarantined: number; guidelineGaps: string[]};
  recentRules: LearnedRule[];
}

export type ReactionRow = {
  postId: string;
  title: string;
  publishedAt: string | null;
  views: number | null;
  likes: number | null;
  comments: number | null;
  inquiries: number | null;
  leadCardCode: string | null;
}

export type LearningOverview = {
  rows: ReactionRow[];
  rules: LearnedRule[];
}

export type EvalCaseResult = {
  caseId: string;
  title: string;
  photoKind: string;
  trap: string;
  pageAccuracy: string; // '9 / 9' or '—'
  trapResult: 'caught' | 'missed' | 'none';
  passed: boolean;
  note: string | null;
}

export type TrustReport = {
  runAt: string | null;
  pageAccuracy: number | null; // 0~1
  trapDetected: number;
  trapTotal: number;
  injectionDetected: number;
  injectionTotal: number;
  avgCostUsd: number | null;
  cases: EvalCaseResult[];
}

export type ExportResult = {
  text: string;
}
