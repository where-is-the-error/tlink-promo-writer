import { z } from "zod";
import { jsonBody, route, uuid } from "@/lib/http";
import { resolveFinding } from "@/lib/services/materials";

/** PATCH /api/injection-findings/:id — 격리 처리 */
export const PATCH = route<{ id: string }>(async (req, { id }) => {
  const body = await jsonBody(req, z.object({ status: z.enum(["excluded", "allowed"]) }));
  return resolveFinding(uuid(id), body.status);
});
