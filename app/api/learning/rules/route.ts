import { route } from "@/lib/http";
import { listRules } from "@/lib/learning";

/** GET /api/learning/rules — 학습 규칙 목록 */
export const GET = route(async () => listRules());
