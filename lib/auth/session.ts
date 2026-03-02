import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { AUTH_COOKIE_NAME, SESSION_TTL_SECONDS } from "@/lib/auth/constants";
import {
  SessionIdentity,
  SessionPayload,
  createSessionToken,
  verifySessionToken,
} from "@/lib/auth/jwt";

const commonCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
};

export function setSessionCookie(
  response: NextResponse,
  identity: SessionIdentity,
) {
  response.cookies.set({
    name: AUTH_COOKIE_NAME,
    value: createSessionToken(identity),
    ...commonCookieOptions,
    maxAge: SESSION_TTL_SECONDS,
  });
}

export function clearSessionCookie(response: NextResponse) {
  response.cookies.set({
    name: AUTH_COOKIE_NAME,
    value: "",
    ...commonCookieOptions,
    expires: new Date(0),
  });
}

export function getSessionFromRequest(request: NextRequest): SessionPayload | null {
  const token = request.cookies.get(AUTH_COOKIE_NAME)?.value;
  if (!token) {
    return null;
  }

  return verifySessionToken(token);
}

export async function getSessionFromServerCookies(): Promise<SessionPayload | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(AUTH_COOKIE_NAME)?.value;

  if (!token) {
    return null;
  }

  return verifySessionToken(token);
}
