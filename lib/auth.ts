import type { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { ApiError } from "./http";
import { env } from "./db";

/**
 * 로그인 확인. `Authorization: Bearer <access_token>` 또는 Supabase 세션 쿠키를 받는다.
 * ALLOWED_USER_EMAIL이 설정돼 있으면 그 계정만 통과시킨다(MVP는 사용자 1명).
 */
export async function requireUser(req: NextRequest) {
  const url = env("NEXT_PUBLIC_SUPABASE_URL");
  const anon = env("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  const header = req.headers.get("authorization");
  const bearer = header?.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : null;

  const { data, error } = bearer
    ? await createClient(url, anon, { auth: { persistSession: false } }).auth.getUser(bearer)
    : await createServerClient(url, anon, {
        cookies: { getAll: () => req.cookies.getAll(), setAll: () => {} },
      }).auth.getUser();

  if (error || !data.user) throw new ApiError(401, "unauthorized", "로그인이 필요합니다.");

  const allowed = process.env.ALLOWED_USER_EMAIL?.trim().toLowerCase();
  if (allowed && data.user.email?.toLowerCase() !== allowed) {
    throw new ApiError(403, "forbidden", "이 계정은 사용할 수 없습니다.");
  }
  return data.user;
}
