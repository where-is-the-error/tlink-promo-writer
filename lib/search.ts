import { db, env, must } from "./db";
import { ApiError } from "./http";

/** Voyage 임베딩(1024차원). 모델은 VOYAGE_MODEL로 바꿀 수 있다. */
export async function embed(texts: string[], inputType: "document" | "query"): Promise<number[][]> {
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += 32) {
    const res = await fetch("https://api.voyageai.com/v1/embeddings", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${env("VOYAGE_API_KEY")}` },
      body: JSON.stringify({
        input: texts.slice(i, i + 32),
        model: process.env.VOYAGE_MODEL || "voyage-3.5",
        input_type: inputType,
        output_dimension: 1024,
      }),
    });
    if (!res.ok) throw new ApiError(502, "embedding_error", `임베딩 실패(${res.status})`);
    const json = (await res.json()) as { data: { embedding: number[]; index: number }[] };
    for (const d of json.data.sort((a, b) => a.index - b.index)) out.push(d.embedding);
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
