import { describe, expect, it } from "vitest";
import { parseCardsResponse } from "../lib/ai/cards";
import { checkEvidence } from "../lib/ai/verify";
import { buildExport, runCodeChecks, type CheckInput } from "../lib/checks";
import { bannedFromEdits, cardScores, reactionScore, removedTokens } from "../lib/learning";
import { trigramSimilarity } from "../lib/text";
import type { Guideline } from "../lib/types";

const guideline: Guideline = {
  required_keywords: ["통화요약", "콜센터 프로그램", "업무자동화"],
  title_phrases: ["티링크 비즈레코딩", "영업사원 통화관리", "휴대폰 통화녹음", "인터넷전화 자동녹취"],
  footer_lines: ["홈페이지 www.tlinkcrm.com", "블로그 https://blog.naver.com/mobilecrm", "상담 문의 1877-3836", "https://www.tlinkcrm.com/center.php"],
  image_order: ["phone_call", "voip_list", "ai_summary", "staff_stats", "report"],
  sections: [],
  missions: [],
  hashtags: ["#티링크"],
};

const s = (section_no: number, order_no: number, text: string) => ({
  section_no, order_no, text, source_type: "card", source_ref: "C-01", deleted: false,
});

const good: CheckInput = {
  title: "티링크 비즈레코딩 통화요약 후기",
  sentences: [
    s(1, 0, "영업사원 통화관리가 늘 고민이었는데 휴대폰 통화녹음과 인터넷전화 자동녹취를 한 번에 해결했습니다."),
    s(3, 1, "AI 통화 요약 덕분에 콜센터프로그램을 따로 쓰지 않아도 업무 자동화가 됩니다."),
  ],
  photos: [
    { kind: "screen", screen_type: "phone_call", order_index: 0 },
    { kind: "screen", screen_type: "ai_summary", order_index: 1 },
  ],
  guideline,
  pastSentences: [],
  bannedPhrases: [],
};

const status = (input: CheckInput) => Object.fromEntries(runCodeChecks(input).map((r) => [r.item_key, r.status]));

describe("코드 검사(8장)", () => {
  it("조건을 모두 채우면 7개 항목이 통과한다(띄어쓰기 무시)", () => {
    const r = status(good);
    expect(Object.keys(r)).toHaveLength(7);
    expect(Object.values(r).every((v) => v === "pass")).toBe(true);
  });

  it("필수 키워드·제목 문구가 빠지면 실패한다", () => {
    const r = status({ ...good, title: "후기", sentences: [s(1, 0, "그냥 좋았습니다.")] });
    expect(r.required_keywords).toBe("fail");
    expect(r.title_phrases).toBe("fail");
  });

  it("금지 표현, 사진 순서, 중복 문장, 출처 없는 문장을 잡는다", () => {
    const r = status({
      ...good,
      sentences: [...good.sentences, s(5, 2, "업계 1위 솔루션입니다."), { ...s(5, 3, "출처 없음"), source_ref: "" }],
      photos: [
        { kind: "screen", screen_type: "report", order_index: 0 },
        { kind: "screen", screen_type: "phone_call", order_index: 1 },
      ],
      pastSentences: [good.sentences[0].text],
    });
    expect(r.banned_phrases).toBe("fail");
    expect(r.image_order).toBe("fail");
    expect(r.no_duplicates).toBe("fail");
    expect(r.all_sourced).toBe("fail");
  });

  it("지운 문장은 검사와 내보내기에서 빠지고, 내보내기에 하단 정보가 붙는다", () => {
    const out = buildExport({
      title: "제목",
      sentences: [s(1, 0, "첫 문장."), { ...s(1, 1, "지운 문장."), deleted: true }, s(2, 2, "둘째 단락.")],
      footer_lines: guideline.footer_lines,
      hashtags: ["#티링크"],
    });
    expect(out.text).not.toContain("지운 문장");
    expect(out.body).toBe("첫 문장.\n\n둘째 단락.");
    expect(out.text).toContain("1877-3836");
    expect(out.text).not.toContain("C-01");
  });
});

describe("카드 파싱(6-1)", () => {
  it("카드 구간의 인용 위치에서만 쪽을 모으고, 인용 없는 카드는 버린다", () => {
    const { cards, conflicts } = parseCardsResponse([
      { type: "text", text: "[CARD]\n주장: " },
      {
        type: "text",
        text: "휴대폰·인터넷전화·PC폰 통화를 한 서버에 녹음한다",
        citations: [{ type: "page_location", document_index: 0, start_page_number: 3, end_page_number: 4, cited_text: "하나의 서버" }],
      },
      { type: "text", text: "\n이익: 외근 통화도 이력에 남는다\n조건: 없음\n[/CARD]\n[CARD]\n주장: 인용 없는 주장\n이익: 없음\n조건: 없음\n[/CARD]\n" },
      { type: "text", text: "[CONFLICT]\n특허 번호가 쪽마다 다르다\n[/CONFLICT]" },
    ]);
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ claim: "휴대폰·인터넷전화·PC폰 통화를 한 서버에 녹음한다", condition: null });
    expect(cards[0].citations).toEqual([{ document_index: 0, position: 2, cited_text: "하나의 서버" }]);
    expect(conflicts).toEqual(["특허 번호가 쪽마다 다르다"]);
  });
});

describe("근거 실재 확인(6-4)", () => {
  const sources = {
    pages: [{ material_id: "m1", material: "제안서", page_no: 6, text: "같은 이슈가 3회 반복되면\nRED 알림으로 긴급 경보" }],
    photos: [{ id: "p1", description: "휴대폰 통화 화면" }],
    memo: "영업팀 8명 도입",
  };

  it("원문에 있는 인용은 공백이 달라도 인정한다", () => {
    const r = checkEvidence(
      { verdict: "match", reason: "근거 있음", evidence: [{ material: "제안서", page_no: 6, quote: "3회 반복되면 RED 알림" }] },
      sources,
    );
    expect(r.verdict).toBe("match");
    expect(r.evidence[0].material_id).toBe("m1");
  });

  it("원문에 없는 인용은 버리고 match를 unsupported로 바꾼다", () => {
    const r = checkEvidence(
      { verdict: "match", reason: "근거 있음", evidence: [{ material: "제안서", page_no: 6, quote: "고객 이탈 위험을 보여 준다" }] },
      sources,
    );
    expect(r.verdict).toBe("unsupported");
    expect(r.evidence).toHaveLength(0);
  });

  it("메모·사진 근거도 같은 방식으로 확인한다", () => {
    const r = checkEvidence(
      { verdict: "match", reason: "", evidence: [{ material: "memo", page_no: 0, quote: "영업팀 8명" }, { material: "photo:p1", page_no: 0, quote: "없는 내용" }] },
      sources,
    );
    expect(r.evidence).toHaveLength(1);
  });
});

describe("학습 규칙(12장)", () => {
  it("반응 점수와 카드 평균 점수를 계산한다", () => {
    expect(reactionScore({ inquiries: 2, likes: 3, comments: 1, views: 400 })).toBe(19);
    const scores = cardScores([
      { leadCards: ["C-01"], score: 10 },
      { leadCards: ["C-01", "C-02"], score: 20 },
    ]);
    expect(scores.get("C-01")).toBe(15);
    expect(scores.get("C-02")).toBe(20);
  });

  it("두 번 이상 지운 어절만 금지 표현이 된다", () => {
    expect(removedTokens("정말 혁신적인 기능입니다.", "정말 기능입니다.")).toEqual(["혁신적인"]);
    const banned = bannedFromEdits([
      { before: "정말 혁신적인 기능입니다.", after: "정말 기능입니다." },
      { before: "혁신적인 리포트를 봅니다.", after: "리포트를 봅니다." },
      { before: "놀라운 결과였습니다.", after: "결과였습니다." },
    ]);
    expect(banned).toEqual([{ phrase: "혁신적인", count: 2 }]);
  });

  it("trigram 유사도: 같은 문장은 1, 다른 문장은 낮다", () => {
    expect(trigramSimilarity("통화가 끝나면 자동으로 기록됩니다", "통화가 끝나면 자동으로 기록됩니다")).toBe(1);
    expect(trigramSimilarity("통화가 끝나면 자동으로 기록됩니다", "리포트는 매주 생성됩니다")).toBeLessThan(0.3);
  });
});
