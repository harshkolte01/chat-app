import { createHmac, timingSafeEqual } from "node:crypto";
import {
  PIN_UNLOCK_HEADER_NAME,
  PIN_UNLOCK_QUERY_PARAM,
  PIN_UNLOCK_TTL_SECONDS,
} from "./constants";

export const PIN_LENGTH = 6;
export const PIN_REGEX = /^\d{6}$/;

type PinUnlockHeader = {
  alg: "HS256";
  typ: "JWT";
};

export type PinUnlockIdentity = {
  sub: string;
  pinVersion: number;
};

export type PinUnlockPayload = PinUnlockIdentity & {
  type: "pin_unlock";
  iat: number;
  exp: number;
};

function getPinJwtSecret(): string {
  const secret = process.env.AUTH_JWT_SECRET ?? process.env.INVITE_CODE;
  if (!secret) {
    throw new Error("Missing AUTH_JWT_SECRET (or INVITE_CODE fallback).");
  }

  return secret;
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

function isPinUnlockPayload(value: unknown): value is PinUnlockPayload {
  if (!value || typeof value !== "object") {
    return false;
  }

  const payload = value as Partial<PinUnlockPayload>;
  return (
    payload.type === "pin_unlock" &&
    typeof payload.sub === "string" &&
    typeof payload.pinVersion === "number" &&
    typeof payload.iat === "number" &&
    typeof payload.exp === "number"
  );
}

export function normalizePin(pin: string): string {
  return pin.trim();
}

export function isValidPin(pin: string): boolean {
  return PIN_REGEX.test(pin);
}

export function createPinUnlockToken(identity: PinUnlockIdentity): string {
  const nowInSeconds = Math.floor(Date.now() / 1000);
  const payload: PinUnlockPayload = {
    ...identity,
    type: "pin_unlock",
    iat: nowInSeconds,
    exp: nowInSeconds + PIN_UNLOCK_TTL_SECONDS,
  };

  const header: PinUnlockHeader = {
    alg: "HS256",
    typ: "JWT",
  };

  const encodedHeader = encodeBase64Url(JSON.stringify(header));
  const encodedPayload = encodeBase64Url(JSON.stringify(payload));
  const signature = sign(`${encodedHeader}.${encodedPayload}`, getPinJwtSecret());

  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

export function verifyPinUnlockToken(token: string): PinUnlockPayload | null {
  const parts = token.split(".");
  if (parts.length !== 3) {
    return null;
  }

  const [encodedHeader, encodedPayload, receivedSignature] = parts;
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const expectedSignature = sign(signingInput, getPinJwtSecret());
  const receivedBuffer = Buffer.from(receivedSignature, "utf8");
  const expectedBuffer = Buffer.from(expectedSignature, "utf8");

  if (
    receivedBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(receivedBuffer, expectedBuffer)
  ) {
    return null;
  }

  const header = safeJsonParse<PinUnlockHeader>(decodeBase64Url(encodedHeader));
  if (!header || header.alg !== "HS256" || header.typ !== "JWT") {
    return null;
  }

  const payload = safeJsonParse<unknown>(decodeBase64Url(encodedPayload));
  if (!isPinUnlockPayload(payload)) {
    return null;
  }

  const nowInSeconds = Math.floor(Date.now() / 1000);
  if (payload.exp <= nowInSeconds) {
    return null;
  }

  return payload;
}

export function getPinUnlockTokenFromRequest(request: Request): string | null {
  const headerValue = request.headers.get(PIN_UNLOCK_HEADER_NAME)?.trim();
  if (headerValue) {
    return headerValue;
  }

  const requestUrl = new URL(request.url);
  const queryValue = requestUrl.searchParams.get(PIN_UNLOCK_QUERY_PARAM)?.trim();
  return queryValue || null;
}

export function isValidPinUnlockForUser(
  user: {
    id: string;
    pinHash: string | null;
    pinVersion: number;
  },
  token: string | null,
): boolean {
  if (!token || !user.pinHash) {
    return false;
  }

  const payload = verifyPinUnlockToken(token);
  return payload?.sub === user.id && payload.pinVersion === user.pinVersion;
}
