import type {CheckStatus, PhotoKind, PostStatus, ScreenType, Verdict} from './types';

export const SCREEN_LABEL: Record<ScreenType, string> = {
  phone_call: '휴대폰 통화 화면',
  voip_list: '인터넷전화 녹취 목록',
  ai_summary: 'AI 통화요약',
  staff_stats: '직원별 통계',
  report: '종합 리포트',
};

export const KIND_LABEL: Record<PhotoKind, string> = {
  site: '① 설치 현장',
  screen: '② 화면 캡처',
  scene: '③ 사용 장면',
};

export const SECTION_TITLE: Record<number, string> = {
  1: '① 기존 영업관리의 문제',
  2: '② 휴대폰·인터넷전화 동시 녹음',
  3: '③ AI 자동 기록과 요약',
  4: '④ 영업사원 관리',
  5: '⑤ 경영진 종합 리포트',
};

/** Astryx Badge variant */
export type BadgeVariant = 'neutral' | 'info' | 'success' | 'warning' | 'error';

export const VERDICT_BADGE: Record<Verdict, {label: string; variant: BadgeVariant}> = {
  pending: {label: '검증 전', variant: 'neutral'},
  match: {label: '일치', variant: 'success'},
  exaggeration: {label: '확인 필요 · 과장', variant: 'error'},
  unsupported: {label: '확인 필요 · 근거 없음', variant: 'error'},
};

export const CHECK_BADGE: Record<CheckStatus, {label: string; variant: BadgeVariant}> = {
  pass: {label: '통과', variant: 'success'},
  fail: {label: '확인 필요', variant: 'error'},
  omitted: {label: '뺌', variant: 'warning'},
};

export const POST_STATUS_BADGE: Record<PostStatus, {label: string; variant: BadgeVariant}> = {
  draft: {label: '초안', variant: 'warning'},
  approved: {label: '승인됨', variant: 'info'},
  published: {label: '게시됨', variant: 'success'},
};

export const isUnresolved = (v: Verdict) => v === 'exaggeration' || v === 'unsupported';
