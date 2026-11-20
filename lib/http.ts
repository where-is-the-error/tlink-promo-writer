import { NextRequest, NextResponse } from "next/server";
import type { z } from "zod";
import { requireUser } from "./auth";

/** 모든 오류 응답은 `{error: {code, message}}` 형식이다. */
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export function errorResponse(e: unknown): NextResponse {
  if (e instanceof ApiError) {
    return NextResponse.json({ error: { code: e.code, message: e.message } }, { status: e.status });
  }
  console.error(e);
  return NextResponse.json(
    { error: { code: "internal_error", message: "서버 오류가 발생했습니다." } },
    { status: 500 },
  );
}

/** 라우트 공통 래퍼: 로그인 확인 → 핸들러 실행 → JSON 응답 / 오류 형식 통일. */
export function route<P = Record<string, never>>(
  handler: (req: NextRequest, params: P) => Promise<unknown>,
) {
  return async (req: NextRequest, ctx: { params: Promise<P> }) => {
    try {
      await requireUser(req);
      const result = await handler(req, await ctx.params);
      return result instanceof Response ? result : NextResponse.json(result ?? {});
    } catch (e) {
      return errorResponse(e);
    }
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function uuid(value: string, name = "id"): string {
  if (!UUID.test(value)) throw new ApiError(400, "invalid_id", `${name} 형식이 올바르지 않습니다.`);
  return value;
}

export async function jsonBody<S extends z.ZodType>(req: NextRequest, schema: S): Promise<z.infer<S>> {
  let raw: unknown;
  try {
    const text = await req.text();
    raw = text ? JSON.parse(text) : {};
  } catch {
    throw new ApiError(400, "invalid_json", "요청 본문이 JSON이 아닙니다.");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new ApiError(400, "invalid_body", `${issue.path.join(".") || "body"}: ${issue.message}`);
  }
  return parsed.data;
}

export async function formBody(req: NextRequest): Promise<FormData> {
  try {
    return await req.formData();
  } catch {
    throw new ApiError(400, "invalid_form", "multipart/form-data 형식이어야 합니다.");
  }
}
