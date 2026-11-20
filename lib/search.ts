import { ApiError as GeminiApiError } from "@google/genai";
import { genai } from "./ai/client";
import { db, must } from "./db";
import { ApiError } from "./http";

/** Gemini 임베딩(1024차원 — DB의 vector(1024)와 맞춘다). 모델은 GEMINI_EMBEDDING_MODEL로 바꿀 수 있다. */
export async function embed(texts: string[], inputType: "document" | "query"): Promise<number[][]> {
  const out: number[][] = [];
  try {
    for (let i = 0; i < texts.length; i += 32) {
      const res = await genai().models.embedContent({
        model: process.env.GEMINI_EMBEDDING_MODEL || "gemini-embedding-001",
        contents: texts.slice(i, i + 32),
        config: {
          taskType: inputType === "document" ? "RETRIEVAL_DOCUMENT" : "RETRIEVAL_QUERY",
          outputDimensionality: 1024,
        },
      });
      for (const e of res.embeddings ?? []) out.push(e.values ?? []);
    }
  } catch (e) {
    const status = e instanceof GeminiApiError ? e.status : "?";
    throw new ApiError(502, "embedding_error", `임베딩 실패(${status})`);
  }
  if (out.length !== texts.length || out.some((v) => v.length !== 1024)) {
    throw new ApiError(502, "embedding_error", "임베딩 결과가 요청과 맞지 않습니다.");
  }
  return out;
}

export const toVector = (v: number[]) => JSON.stringify(v);

export interface MatchedPage {
  page_id: string;
  material_id: string;
  page_no: number;
  text: string;
  score: number;
}

/** 3-1 하이브리드 검색(의미 + 부분 일치, RRF). 격리된 쪽은 나오지 않는다. */
export async function matchPages(embedding: number[], text: string, k = 5): Promise<MatchedPage[]> {
  return must(
    await db().rpc("match_pages", { q_embedding: toVector(embedding), q_text: text, k }),
  ) as MatchedPage[];
}
