import { z } from "zod";
import { jsonBody, route } from "@/lib/http";
import { createPost, listPosts } from "@/lib/services/posts";

/** GET /api/posts — 글 목록(홈·반응 입력표) */
export const GET = route(async () => listPosts());

/** POST /api/posts — 글 시작 */
export const POST = route(async (req) => {
  const body = await jsonBody(req, z.object({ memo: z.string().trim().min(1, "메모를 입력해야 합니다.").max(2000) }));
  return createPost(body.memo);
});
