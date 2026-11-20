import { route } from "@/lib/http";
import { listCards } from "@/lib/services/cards";

/** GET /api/cards — 카드 목록(priority_score 내림차순) */
export const GET = route(async () => ({ cards: await listCards() }));
