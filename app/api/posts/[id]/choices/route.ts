import { z } from "zod";
import { jsonBody, route, uuid } from "@/lib/http";
import { setChoice } from "@/lib/services/posts";

/** PATCH /api/posts/:id/choices — 카드 선택(selected: false로 해제) */
export const PATCH = route<{ id: string }>(async (req, { id }) => {
  const body = await jsonBody(
    req,
    z.object({ photo_id: z.string(), card_id: z.string(), selected: z.boolean().default(true) }),
  );
  return setChoice(uuid(id), uuid(body.photo_id, "photo_id"), uuid(body.card_id, "card_id"), body.selected);
});
