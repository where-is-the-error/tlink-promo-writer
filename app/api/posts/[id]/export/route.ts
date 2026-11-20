import { route, uuid } from "@/lib/http";
import { exportPost } from "@/lib/services/posts";

/** GET /api/posts/:id/export — 블로그용 본문(approved가 아니면 409) */
export const GET = route<{ id: string }>(async (_req, { id }) => exportPost(uuid(id)));
