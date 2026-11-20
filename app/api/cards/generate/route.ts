import { z } from "zod";
import { jsonBody, route } from "@/lib/http";
import { generateCards } from "@/lib/services/cards";

export const maxDuration = 800;

/** POST /api/cards/generate — 차별점 카드 생성(6-1) */
export const POST = route(async (req) => {
  const body = await jsonBody(req, z.object({ replace: z.boolean().default(false) }));
  return generateCards(body.replace);
});
