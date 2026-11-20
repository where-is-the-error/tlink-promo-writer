import { route, uuid } from "@/lib/http";
import { verifyPost } from "@/lib/services/posts";

export const maxDuration = 300;

/** POST /api/posts/:id/verify — 원문 대조(6-4) */
export const POST = route<{ id: string }>(async (_req, { id }) => verifyPost(uuid(id)));
