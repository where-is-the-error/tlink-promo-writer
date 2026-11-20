import { z } from "zod";
import { jsonBody, route, uuid } from "@/lib/http";
import { writePost } from "@/lib/services/posts";

export const maxDuration = 300;

/** POST /api/posts/:id/write — 글 쓰기(6-3) → 코드 검사(8장) */
export const POST = route<{ id: string }>(async (req, { id }) => {
  const body = await jsonBody(req, z.object({ rewrite: z.boolean().default(false) }));
  return writePost(uuid(id), body.rewrite);
});
