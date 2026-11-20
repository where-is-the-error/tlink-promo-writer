/** 공백·제로폭 문자를 모두 지운 비교용 문자열. */
export function compact(s: string): string {
  return s.replace(/[\s​-‍﻿]+/g, "");
}

/** 띄어쓰기 무시 포함 검사. */
export function includesLoose(haystack: string, needle: string): boolean {
  return compact(haystack).toLowerCase().includes(compact(needle).toLowerCase());
}

/** 쪽 원문을 문장 단위로 나눈다(지시문 판별 입력용). */
export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?。])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function trigrams(s: string): Set<string> {
  const out = new Set<string>();
  for (const word of s.toLowerCase().split(/\s+/).filter(Boolean)) {
    const padded = `  ${word} `;
    for (let i = 0; i + 3 <= padded.length; i++) out.add(padded.slice(i, i + 3));
  }
  return out;
}

/** pg_trgm의 similarity()와 같은 방식(단어별 패딩 trigram의 자카드 유사도). */
export function trigramSimilarity(a: string, b: string): number {
  const ta = trigrams(a);
  const tb = trigrams(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let common = 0;
  for (const t of ta) if (tb.has(t)) common++;
  return common / (ta.size + tb.size - common);
}
