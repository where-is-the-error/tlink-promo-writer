import { z } from "zod";
import { jsonBody, route, uuid } from "@/lib/http";
import { saveReactions } from "@/lib/services/posts";

const count = z.number().int().min(0);

/** POST /api/posts/:id/reactions — 반응 입력 */
export const POST = route<{ id: string }>(async (req, { id }) => {
  const body = await jsonBody(req, z.object({ views: count, likes: count, comments: count, inquiries: count }));
  return saveReactions(uuid(id), body);
});
