import { after } from "next/server";
import { ApiError, formBody, route } from "@/lib/http";
import { listMaterials, registerMaterial, scanMaterial } from "@/lib/services/materials";

export const maxDuration = 300;

/** GET /api/materials — 자료·격리 현황 */
export const GET = route(async () => listMaterials());

/** POST /api/materials — PDF 1개 등록(multipart: file, name?, exclude_pages?="14,15") */
export const POST = route(async (req) => {
  const form = await formBody(req);
  const file = form.get("file");
  if (!(file instanceof File)) throw new ApiError(400, "file_required", "file 필드에 PDF를 넣어야 합니다.");
  const exclude = String(form.get("exclude_pages") ?? "")
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n > 0);
  const name = form.get("name");

  const { material_id, bytes } = await registerMaterial(file, typeof name === "string" ? name : null, exclude);
  // 숨은 지시 검사·임베딩은 시간이 걸려 응답 뒤에 돈다. 끝나기 전까지 자료는 "검사 중"이다.
  after(() => scanMaterial(material_id, bytes, exclude).catch((e) => console.error("scan failed", e)));
  return { material_id, status: "scanning" };
});
