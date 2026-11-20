import { route, uuid } from "@/lib/http";
import { approvePost } from "@/lib/services/posts";

/** POST /api/posts/:id/approve — 승인(확인 필요·코드 검사 실패가 있으면 409) */
export const POST = route<{ id: string }>(async (_req, { id }) => approvePost(uuid(id)));
