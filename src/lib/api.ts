/**
 * 화면이 쓰는 데이터 함수 모음.
 * NEXT_PUBLIC_DATA_SOURCE=mock 이면 가짜 데이터(mock.ts), api 이면 실제 /api 라우트를 부릅니다.
 * 각 함수 위 주석의 메서드·경로가 API 담당이 만들 엔드포인트입니다 (docs/API_CONTRACT.md).
 */
import type {
  Card,
  Dashboard,
  ExportResult,
  LearningOverview,
  MaterialsOverview,
  PostDetail,
  Sentence,
  TrustReport,
} from './types';
import {mockSource} from './mock';

export interface PhotoUpload {
  blob: Blob;
  fileName: string;
}

export interface DataSource {
  /** GET /api/dashboard */
  getDashboard(): Promise<Dashboard>;
  /** GET /api/materials */
  getMaterials(): Promise<MaterialsOverview>;
  /** POST /api/materials (multipart: file) */
  uploadMaterial(file: File): Promise<void>;
  /** PATCH /api/injection-findings/:id  {status} */
  resolveFinding(id: string, status: 'excluded' | 'allowed'): Promise<void>;
  /** GET /api/cards */
  getCards(): Promise<Card[]>;
  /** POST /api/cards/generate  {replace:true} */
  generateCards(): Promise<Card[]>;
  /** POST /api/posts {memo} → {postId} */
  createPost(memo: string): Promise<{postId: string}>;
  /** POST /api/posts/:id/photos (multipart: image, masked=true) — 가린 이미지만 */
  uploadPhoto(postId: string, photo: PhotoUpload): Promise<void>;
  /** POST /api/posts/:id/classify */
  classifyPost(postId: string): Promise<PostDetail>;
  /** GET /api/posts/:id */
  getPost(postId: string): Promise<PostDetail>;
  /** PATCH /api/posts/:id/choices {photoId, cardId, selected} */
  setChoice(postId: string, photoId: string, cardId: string, selected: boolean): Promise<PostDetail>;
  /** POST /api/posts/:id/write {rewrite} → 글 쓰기 + 코드 검사 */
  writePost(postId: string, rewrite?: boolean): Promise<PostDetail>;
  /** POST /api/posts/:id/verify → 원문 대조 */
  verifyPost(postId: string): Promise<PostDetail>;
  /** PATCH /api/sentences/:id {text} | {deleted:true} | {acceptSuggestion:true} → 재검증 후 글 전체 반환 */
  updateSentence(
    postId: string,
    sentenceId: string,
    change: {text: string} | {deleted: true} | {acceptSuggestion: true},
  ): Promise<PostDetail>;
  /** POST /api/posts/:id/approve (확인 필요가 남으면 409) */
  approvePost(postId: string): Promise<PostDetail>;
  /** GET /api/posts/:id/export (approved 아니면 409) */
  exportPost(postId: string): Promise<ExportResult>;
  /** PATCH /api/posts/:id {publishedUrl} */
  savePublishedUrl(postId: string, url: string): Promise<void>;
  /** GET /api/learning */
  getLearning(): Promise<LearningOverview>;
  /** POST /api/posts/:id/reactions {views,likes,comments,inquiries} */
  saveReactions(postId: string, r: {views: number; likes: number; comments: number; inquiries: number}): Promise<void>;
  /** POST /api/learning/recompute */
  recomputeLearning(): Promise<LearningOverview>;
  /** PATCH /api/learning/rules/:id {active} */
  toggleRule(ruleId: string, active: boolean): Promise<LearningOverview>;
  /** GET /api/eval/latest */
  getTrust(): Promise<TrustReport>;
  /** POST /api/eval/run */
  runEval(): Promise<TrustReport>;
}

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: init?.body instanceof FormData ? init.headers : {'Content-Type': 'application/json', ...init?.headers},
  });
  if (!res.ok) {
    let code = 'error';
    let message = `요청 실패 (${res.status})`;
    try {
      const body = await res.json();
      code = body?.error?.code ?? code;
      message = body?.error?.message ?? message;
    } catch {
      // 본문이 JSON이 아닐 때는 기본 메시지
    }
    throw new ApiError(res.status, code, message);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

const json = (body: unknown): RequestInit => ({body: JSON.stringify(body)});

const httpSource: DataSource = {
  getDashboard: () => call('/api/dashboard'),
  getMaterials: () => call('/api/materials'),
  uploadMaterial: async (file) => {
    const fd = new FormData();
    fd.append('file', file);
    await call('/api/materials', {method: 'POST', body: fd});
  },
  resolveFinding: (id, status) => call(`/api/injection-findings/${id}`, {method: 'PATCH', ...json({status})}),
  getCards: () => call('/api/cards'),
  generateCards: () => call('/api/cards/generate', {method: 'POST', ...json({replace: true})}),
  createPost: (memo) => call('/api/posts', {method: 'POST', ...json({memo})}),
  uploadPhoto: async (postId, photo) => {
    const fd = new FormData();
    fd.append('image', photo.blob, photo.fileName);
    fd.append('masked', 'true');
    await call(`/api/posts/${postId}/photos`, {method: 'POST', body: fd});
  },
  classifyPost: (postId) => call(`/api/posts/${postId}/classify`, {method: 'POST'}),
  getPost: (postId) => call(`/api/posts/${postId}`),
  setChoice: (postId, photoId, cardId, selected) =>
    call(`/api/posts/${postId}/choices`, {method: 'PATCH', ...json({photoId, cardId, selected})}),
  writePost: (postId, rewrite = false) => call(`/api/posts/${postId}/write`, {method: 'POST', ...json({rewrite})}),
  verifyPost: (postId) => call(`/api/posts/${postId}/verify`, {method: 'POST'}),
  updateSentence: (_postId, sentenceId, change) =>
    call(`/api/sentences/${sentenceId}`, {method: 'PATCH', ...json(change)}),
  approvePost: (postId) => call(`/api/posts/${postId}/approve`, {method: 'POST'}),
  exportPost: (postId) => call(`/api/posts/${postId}/export`),
  savePublishedUrl: (postId, url) => call(`/api/posts/${postId}`, {method: 'PATCH', ...json({publishedUrl: url})}),
  getLearning: () => call('/api/learning'),
  saveReactions: (postId, r) => call(`/api/posts/${postId}/reactions`, {method: 'POST', ...json(r)}),
  recomputeLearning: () => call('/api/learning/recompute', {method: 'POST'}),
  toggleRule: (ruleId, active) => call(`/api/learning/rules/${ruleId}`, {method: 'PATCH', ...json({active})}),
  getTrust: () => call('/api/eval/latest'),
  runEval: () => call('/api/eval/run', {method: 'POST'}),
};

export const api: DataSource = process.env.NEXT_PUBLIC_DATA_SOURCE === 'api' ? httpSource : mockSource;

export const isMock = process.env.NEXT_PUBLIC_DATA_SOURCE !== 'api';
