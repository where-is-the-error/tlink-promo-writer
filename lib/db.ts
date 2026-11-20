import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { ApiError } from "./http";
import { localClient } from "./local/store";
import type { Guideline } from "./types";

export function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new ApiError(500, "missing_env", `환경 변수 ${name}이(가) 없습니다.`);
  return value;
}

/**
 * Supabase 주소가 없으면 로컬 모드다: DB·파일은 .local-data/ 에 저장하고 로그인 확인을 건너뛴다.
 * 내 컴퓨터에서 혼자 돌려 볼 때만 쓴다. 배포할 때는 Supabase 환경 변수를 넣는다.
 */
export function isLocal(): boolean {
  return !process.env.NEXT_PUBLIC_SUPABASE_URL;
}

let client: SupabaseClient | null = null;

/** 서버 전용 DB 클라이언트(service role 또는 로컬 저장소). 브라우저 코드에서 import하지 않는다. */
export function db(): SupabaseClient {
  if (isLocal()) return localClient as unknown as SupabaseClient;
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
