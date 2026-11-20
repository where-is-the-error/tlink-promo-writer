import { route } from "@/lib/http";
import { recomputeLearning } from "@/lib/learning";

export const maxDuration = 120;

/** POST /api/learning/recompute — 학습 규칙 재계산(12장) */
export const POST = route(async () => recomputeLearning());
