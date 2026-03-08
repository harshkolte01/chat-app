import { createHmac, timingSafeEqual } from "node:crypto";
import {
  REALTIME_TOKEN_EXPIRED_CODE,
  REALTIME_TOKEN_INVALID_CODE,
  RealtimeTokenErrorCode,
} from "./contracts";

type RealtimeTokenHeader = {
  alg: "HS256";
  typ: "JWT";
};

export type RealtimeTokenIdentity = {
  sub: string;
  email: string;
  username: string;
  pinVersion: number;
};

export type RealtimeTokenPayload = RealtimeTokenIdentity & {
  type: "realtime";
  iat: number;
  exp: number;
};

type RealtimeTokenVerificationSuccess = {
  ok: true;
  payload: RealtimeTokenPayload;
};

type RealtimeTokenVerificationFailure = {
  ok: false;
  code: RealtimeTokenErrorCode;
};

export type RealtimeTokenVerificationResult =
  | RealtimeTokenVerificationSuccess
  | RealtimeTokenVerificationFailure;

const DEFAULT_REALTIME_TOKEN_TTL_SECONDS = 60 * 60;

function getRealtimeTokenSecret(): string {
  const secret =
    process.env.REALTIME_AUTH_JWT_SECRET ?? process.env.AUTH_JWT_SECRET ?? process.env.INVITE_CODE;
  if (!secret) {
    throw new Error("Missing REALTIME_AUTH_JWT_SECRET (or AUTH_JWT_SECRET / INVITE_CODE fallback).");
  }

  return secret;
}

export function getRealtimeTokenTtlSeconds(): number {
  const parsed = Number(process.env.REALTIME_TOKEN_TTL_SECONDS ?? DEFAULT_REALTIME_TOKEN_TTL_SECONDS);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_REALTIME_TOKEN_TTL_SECONDS;
  }

  return Math.max(60, Math.floor(parsed));
}

function encodeBase64Url(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function decodeBase64Url(value: string): string {
  return Buffer.from(value, "base64url").toString("utf8");
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

function isRealtimeTokenPayload(value: unknown): value is RealtimeTokenPayload {
  if (!value || typeof value !== "object") {
    return false;
  }

  const payload = value as Partial<RealtimeTokenPayload>;
  return (
    payload.type === "realtime" &&
    typeof payload.sub === "string" &&
    typeof payload.email === "string" &&
    typeof payload.username === "string" &&
    typeof payload.pinVersion === "number" &&
    typeof payload.iat === "number" &&
    typeof payload.exp === "number"
  );
}

export function createRealtimeToken(identity: RealtimeTokenIdentity): string {
  const nowInSeconds = Math.floor(Date.now() / 1000);
  const payload: RealtimeTokenPayload = {
    ...identity,
    type: "realtime",
    iat: nowInSeconds,
    exp: nowInSeconds + getRealtimeTokenTtlSeconds(),
  };

  const header: RealtimeTokenHeader = {
    alg: "HS256",
    typ: "JWT",
  };

  const encodedHeader = encodeBase64Url(JSON.stringify(header));
  const encodedPayload = encodeBase64Url(JSON.stringify(payload));
  const signature = sign(`${encodedHeader}.${encodedPayload}`, getRealtimeTokenSecret());

  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

export function verifyRealtimeToken(token: string): RealtimeTokenVerificationResult {
  const parts = token.split(".");
  if (parts.length !== 3) {
    return {
      ok: false,
      code: REALTIME_TOKEN_INVALID_CODE,
    };
  }

  const [encodedHeader, encodedPayload, receivedSignature] = parts;
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const expectedSignature = sign(signingInput, getRealtimeTokenSecret());
  const receivedBuffer = Buffer.from(receivedSignature, "utf8");
  const expectedBuffer = Buffer.from(expectedSignature, "utf8");

  if (
    receivedBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(receivedBuffer, expectedBuffer)
  ) {
    return {
      ok: false,
      code: REALTIME_TOKEN_INVALID_CODE,
    };
  }

  const header = safeJsonParse<RealtimeTokenHeader>(decodeBase64Url(encodedHeader));
  if (!header || header.alg !== "HS256" || header.typ !== "JWT") {
    return {
      ok: false,
      code: REALTIME_TOKEN_INVALID_CODE,
    };
  }

  const payload = safeJsonParse<unknown>(decodeBase64Url(encodedPayload));
  if (!isRealtimeTokenPayload(payload)) {
    return {
      ok: false,
      code: REALTIME_TOKEN_INVALID_CODE,
    };
  }

  const nowInSeconds = Math.floor(Date.now() / 1000);
  if (payload.exp <= nowInSeconds) {
    return {
      ok: false,
      code: REALTIME_TOKEN_EXPIRED_CODE,
    };
  }

  return {
    ok: true,
    payload,
  };
}
