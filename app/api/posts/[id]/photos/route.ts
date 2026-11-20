import { ApiError, formBody, route, uuid } from "@/lib/http";
import { addPhoto } from "@/lib/services/posts";

/** POST /api/posts/:id/photos — 가린 사진 업로드(multipart: file, masked=true) */
export const POST = route<{ id: string }>(async (req, { id }) => {
  const form = await formBody(req);
  if (form.get("masked") !== "true") {
    throw new ApiError(400, "not_masked", "민감정보를 가린 사진만 올릴 수 있습니다. (masked=true 필요)");
  }
  const file = form.get("file") ?? form.get("image");
  if (!(file instanceof File)) throw new ApiError(400, "file_required", "file 필드에 이미지를 넣어야 합니다.");
  return addPhoto(uuid(id), file, true);
});
