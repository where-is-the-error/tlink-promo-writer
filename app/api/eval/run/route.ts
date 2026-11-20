import { route } from "@/lib/http";
import { latestEvalRuns, runEval } from "@/lib/eval";

export const maxDuration = 800;

/** GET /api/eval/run — 최근 평가 결과 */
export const GET = route(async () => latestEvalRuns());

/** POST /api/eval/run — 평가 실행(13장) */
export const POST = route(async () => runEval());
