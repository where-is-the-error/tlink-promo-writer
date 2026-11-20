import { z } from "zod";
import { jsonBody, route, uuid } from "@/lib/http";
import { setRuleActive } from "@/lib/learning";

/** PATCH /api/learning/rules/:id — 규칙 끄고 켜기 */
export const PATCH = route<{ id: string }>(async (req, { id }) => {
  const body = await jsonBody(req, z.object({ active: z.boolean() }));
  return setRuleActive(uuid(id), body.active);
});
