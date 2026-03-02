import { NextResponse } from "next/server";

type ApiError = {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
};

export function ok<T>(data: T, status = 200) {
  return NextResponse.json(data, { status });
}

export function fail(
  status: number,
  code: string,
  message: string,
  details?: unknown,
) {
  const payload: ApiError =
    details === undefined
      ? { error: { code, message } }
      : { error: { code, message, details } };

  return NextResponse.json(payload, { status });
}

export async function parseJsonBody<T>(request: Request): Promise<T | null> {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}
