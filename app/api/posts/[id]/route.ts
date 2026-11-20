import { z } from "zod";
import { jsonBody, route, uuid } from "@/lib/http";
import { getPost, publishPost } from "@/lib/services/posts";

/** GET /api/posts/:id — 글 전체 상태(사진·카드 선택·문장·점검표) */
export const GET = route<{ id: string }>(async (_req, { id }) => getPost(uuid(id)));

/** PATCH /api/posts/:id — 게시 주소 저장(status → published) */
export const PATCH = route<{ id: string }>(async (req, { id }) => {
  const body = await jsonBody(
    req,
    z.object({ published_url: z.string().trim().regex(/^https?:\/\/\S+$/, "http(s) 주소여야 합니다.") }),
  );
  return publishPost(uuid(id), body.published_url);
});
