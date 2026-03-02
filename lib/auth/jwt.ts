import { createHmac, timingSafeEqual } from "node:crypto";
import { SESSION_TTL_SECONDS } from "@/lib/auth/constants";

type JwtHeader = {
  alg: "HS256";
  typ: "JWT";
};

export type SessionIdentity = {
  sub: string;
  email: string;
  username: string;
};

export type SessionPayload = SessionIdentity & {
  iat: number;
  exp: number;
};

function getJwtSecret(): string {
  const secret = process.env.AUTH_JWT_SECRET ?? process.env.INVITE_CODE;
  if (!secret) {
    throw new Error("Missing AUTH_JWT_SECRET (or INVITE_CODE fallback).");
  }
  return secret;
}

function safeJsonParse<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function sign(input: string, secret: string): string {
  return createHmac("sha256", secret).update(input).digest("base64url");
}

function encodeBase64Url(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function decodeBase64Url(value: string): string {
  return Buffer.from(value, "base64url").toString("utf8");
}

function isSessionPayload(value: unknown): value is SessionPayload {
  if (!value || typeof value !== "object") {
    return false;
  }

  const payload = value as Partial<SessionPayload>;
  return (
    typeof payload.sub === "string" &&
    typeof payload.email === "string" &&
    typeof payload.username === "string" &&
    typeof payload.iat === "number" &&
    typeof payload.exp === "number"
  );
}

export function createSessionToken(identity: SessionIdentity): string {
  const nowInSeconds = Math.floor(Date.now() / 1000);
  const payload: SessionPayload = {
    ...identity,
    iat: nowInSeconds,
    exp: nowInSeconds + SESSION_TTL_SECONDS,
  };

  const header: JwtHeader = {
    alg: "HS256",
    typ: "JWT",
  };

  const encodedHeader = encodeBase64Url(JSON.stringify(header));
  const encodedPayload = encodeBase64Url(JSON.stringify(payload));
  const signature = sign(`${encodedHeader}.${encodedPayload}`, getJwtSecret());

  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

export function verifySessionToken(token: string): SessionPayload | null {
  const parts = token.split(".");
  if (parts.length !== 3) {
    return null;
  }

  const [encodedHeader, encodedPayload, receivedSignature] = parts;
  const signingInput = `${encodedHeader}.${encodedPayload}`;

  const expectedSignature = sign(signingInput, getJwtSecret());
  const receivedBuffer = Buffer.from(receivedSignature, "utf8");
  const expectedBuffer = Buffer.from(expectedSignature, "utf8");

  if (
    receivedBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(receivedBuffer, expectedBuffer)
  ) {
    return null;
  }

  const header = safeJsonParse<JwtHeader>(decodeBase64Url(encodedHeader));
  if (!header || header.alg !== "HS256" || header.typ !== "JWT") {
    return null;
  }

  const payload = safeJsonParse<unknown>(decodeBase64Url(encodedPayload));
  if (!isSessionPayload(payload)) {
    return null;
  }

  const nowInSeconds = Math.floor(Date.now() / 1000);
  if (payload.exp <= nowInSeconds) {
    return null;
  }

  return payload;
}
