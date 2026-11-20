import { route, uuid } from "@/lib/http";
import { classifyPost } from "@/lib/services/posts";

export const maxDuration = 300;

/** POST /api/posts/:id/classify — 사진 분류 + 카드 3장 추천(6-2) */
export const POST = route<{ id: string }>(async (_req, { id }) => classifyPost(uuid(id)));
