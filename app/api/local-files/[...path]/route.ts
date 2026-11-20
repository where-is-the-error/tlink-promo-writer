import fs from "node:fs";
import { NextResponse, type NextRequest } from "next/server";
import { isLocal } from "@/lib/db";
import { localFilePath } from "@/lib/local/store";

const TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
};

/** GET /api/local-files/photos/... — 로컬 모드에서만 가린 사진을 내려준다(Supabase 서명 URL 대신). */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const [bucket, ...rest] = (await ctx.params).path;
  if (!isLocal() || bucket !== "photos" || rest.length === 0) return new NextResponse(null, { status: 404 });
  try {
    const file = localFilePath(bucket, rest.join("/"));
    const type = TYPES[file.split(".").pop()?.toLowerCase() ?? ""];
    if (!type) return new NextResponse(null, { status: 404 });
    return new NextResponse(new Uint8Array(fs.readFileSync(file)), {
      headers: { "content-type": type, "cache-control": "private, max-age=600" },
    });
  } catch {
    return new NextResponse(null, { status: 404 });
  }
}
