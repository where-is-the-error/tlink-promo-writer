import { z } from "zod";
import { jsonBody, route, uuid } from "@/lib/http";
import { patchSentence } from "@/lib/services/posts";

export const maxDuration = 300;

const Body = z.union([
  z.strictObject({ text: z.string().trim().min(1).max(1000) }),
  z.strictObject({ deleted: z.literal(true) }),
  z.strictObject({ accept_suggestion: z.literal(true) }),
]);

/** PATCH /api/sentences/:id — 문장 수정·삭제·제안 수락 → 그 문장만 재검증 */
export const PATCH = route<{ id: string }>(async (req, { id }) => patchSentence(uuid(id), await jsonBody(req, Body)));
