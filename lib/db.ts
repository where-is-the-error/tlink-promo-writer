import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { ApiError } from "./http";
import type { Guideline } from "./types";

export function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new ApiError(500, "missing_env", `환경 변수 ${name}이(가) 없습니다.`);
  return value;
}

let client: SupabaseClient | null = null;

/** 서버 전용 service role 클라이언트. 브라우저 코드에서 import하지 않는다. */
export function db(): SupabaseClient {
  client ??= createClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return client;
}

/** Supabase 응답에서 data를 꺼내고, 오류면 500으로 던진다. */
export function must<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new ApiError(500, "db_error", res.error.message);
  return res.data as T;
}

export async function getGuideline(): Promise<Guideline> {
  const row = must(await db().from("guideline").select("*").eq("id", 1).maybeSingle());
  if (!row) throw new ApiError(409, "guideline_missing", "가이드라인이 등록되지 않았습니다.");
  return row as Guideline;
}
