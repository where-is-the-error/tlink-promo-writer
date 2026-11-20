import { compact, includesLoose, trigramSimilarity } from "./text";
import { SCREEN_ORDER, type Guideline } from "./types";

export const DEFAULT_BANNED = ["업계 1위", "최고", "완벽", "100%", "유일"];
const FOOTER_REQUIRED = [
  "www.tlinkcrm.com",
  "https://blog.naver.com/mobilecrm",
  "1877-3836",
  "https://www.tlinkcrm.com/center.php",
];

export interface ExportParts {
  title: string;
  body: string;
  footer: string;
  hashtags: string;
  text: string;
}

interface SentenceLite {
  section_no: number;
  order_no: number;
  text: string;
  source_type?: string | null;
  source_ref?: string | null;
  deleted?: boolean;
}

function ordered<T extends SentenceLite>(sentences: T[]): T[] {
  return sentences
    .filter((s) => !s.deleted)
    .sort((a, b) => a.section_no - b.section_no || a.order_no - b.order_no);
}

/** 블로그용 본문: 근거 표시 없이 제목·본문·하단 정보·해시태그만. 하단 정보는 코드가 붙인다. */
export function buildExport(input: {
  title: string | null;
  sentences: SentenceLite[];
  footer_lines: string[];
  hashtags: string[];
}): ExportParts {
  const sections = new Map<number, string[]>();
  for (const s of ordered(input.sentences)) {
    sections.set(s.section_no, [...(sections.get(s.section_no) ?? []), s.text.trim()]);
  }
  const title = input.title?.trim() ?? "";
  const body = [...sections.values()].map((lines) => lines.join(" ")).join("\n\n");
  const footer = input.footer_lines.join("\n");
  const hashtags = input.hashtags.join(" ");
  return { title, body, footer, hashtags, text: [title, body, footer, hashtags].filter(Boolean).join("\n\n") };
}

export interface CheckInput {
  title: string | null;
  sentences: SentenceLite[];
  photos: { kind: string | null; screen_type: string | null; order_index: number | null }[];
  guideline: Guideline;
  /** 지난 게시 글의 문장들 */
  pastSentences: string[];
  /** learned_rules의 활성 금지 표현 */
  bannedPhrases: string[];
}

export interface CheckResult {
  item_key: string;
  status: "pass" | "fail";
  detail: string | null;
}

/** 8장 코드 검사 7개 항목(순수 함수). */
export function runCodeChecks(i: CheckInput): CheckResult[] {
  const live = ordered(i.sentences);
  const title = i.title ?? "";
  const body = live.map((s) => s.text).join(" ");
  const firstParagraph = live.filter((s) => s.section_no === 1).map((s) => s.text).join(" ");
  const g = i.guideline;
  const results: CheckResult[] = [];
  const add = (item_key: string, problems: string[], note: string | null = null) =>
    results.push({ item_key, status: problems.length ? "fail" : "pass", detail: problems.join(" / ") || note });

  // required_keywords: 제목에 1개 이상, 본문에 모두
  const kw: string[] = [];
  if (!g.required_keywords.some((k) => includesLoose(title, k))) kw.push("제목에 필수 키워드가 없음");
  const missingKw = g.required_keywords.filter((k) => !includesLoose(body, k));
  if (missingKw.length) kw.push(`본문에 없음: ${missingKw.join(", ")}`);
  add("required_keywords", kw);

  // title_phrases: 제목 또는 1단계 첫 문단에 모두
  const missingPhrases = g.title_phrases.filter((p) => !includesLoose(`${title} ${firstParagraph}`, p));
  add("title_phrases", missingPhrases.length ? [`제목·첫 문단에 없음: ${missingPhrases.join(", ")}`] : []);

  // footer: export 텍스트에 필수 정보 4개
  const exportText = buildExport({ title, sentences: live, footer_lines: g.footer_lines, hashtags: g.hashtags }).text;
  const missingFooter = FOOTER_REQUIRED.filter((f) => !exportText.includes(f));
  add("footer", missingFooter.length ? [`하단 정보 없음: ${missingFooter.join(", ")}`] : []);

  // image_order: 화면 캡처 순서. 빠진 것은 허용(경고만)
  const order = SCREEN_ORDER as readonly string[];
  const screens = i.photos
    .filter((p) => p.kind === "screen" && p.screen_type && order.includes(p.screen_type))
    .sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0))
    .map((p) => order.indexOf(p.screen_type!));
  const outOfOrder = screens.some((rank, idx) => idx > 0 && rank < screens[idx - 1]);
  const missingScreens = order.filter((_, idx) => !screens.includes(idx));
  add(
    "image_order",
    outOfOrder ? ["화면 캡처 순서가 가이드라인과 다름"] : [],
    missingScreens.length ? `빠진 사진(경고): ${missingScreens.join(", ")}` : null,
  );

  // no_duplicates: 지난 게시 글과 trigram 유사도 0.9 이상인 문장 0개
  const dup = live.filter((s) => i.pastSentences.some((p) => trigramSimilarity(s.text, p) >= 0.9));
  add("no_duplicates", dup.length ? [`지난 글과 거의 같은 문장 ${dup.length}개: "${dup[0].text.slice(0, 40)}"`] : []);

  // banned_phrases: 기본 금지어 + 학습된 금지 표현
  const whole = compact(`${title} ${body}`);
  const hit = [...new Set([...DEFAULT_BANNED, ...i.bannedPhrases])].filter((b) => whole.includes(compact(b)));
  add("banned_phrases", hit.length ? [`금지 표현: ${hit.join(", ")}`] : []);

  // all_sourced: 모든 문장에 출처 꼬리표
  const unsourced = live.filter((s) => !s.source_type || !s.source_ref);
  add("all_sourced", [
    ...(live.length === 0 ? ["문장이 없음"] : []),
    ...(unsourced.length ? [`출처 없는 문장 ${unsourced.length}개`] : []),
  ]);

  return results;
}
