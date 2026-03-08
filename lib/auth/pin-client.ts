import { PIN_UNLOCK_HEADER_NAME, PIN_UNLOCK_QUERY_PARAM } from "@/lib/auth/constants";

export const PIN_UNLOCK_STORAGE_KEY = "secretchat.pin_unlock";
export const PIN_LOCK_EVENT_NAME = "secretchat:pin-lock";

const PIN_ACCESS_ERROR_CODES = new Set(["PIN_SETUP_REQUIRED", "PIN_UNLOCK_REQUIRED"]);

export function getStoredPinUnlockToken(): string | null {
  if (typeof window === "undefined") {
    return null;
  }

  return window.sessionStorage.getItem(PIN_UNLOCK_STORAGE_KEY);
}

export function hasStoredPinUnlockToken(): boolean {
  return Boolean(getStoredPinUnlockToken());
}

export function storePinUnlockToken(token: string): void {
  if (typeof window === "undefined") {
    return;
  }

  window.sessionStorage.setItem(PIN_UNLOCK_STORAGE_KEY, token);
}

export function clearStoredPinUnlockToken(): void {
  if (typeof window === "undefined") {
    return;
  }

  window.sessionStorage.removeItem(PIN_UNLOCK_STORAGE_KEY);
}

export function createPinProtectedHeaders(headers?: HeadersInit): Headers {
  const nextHeaders = new Headers(headers);
  const token = getStoredPinUnlockToken();
  if (token) {
    nextHeaders.set(PIN_UNLOCK_HEADER_NAME, token);
  }

  return nextHeaders;
}

export function withPinProtectedRequestInit(init?: RequestInit): RequestInit {
  const headers = createPinProtectedHeaders(init?.headers);
  return {
    ...init,
    headers,
  };
}

export function appendPinUnlockQuery(url: string): string {
  const token = getStoredPinUnlockToken();
  if (!token) {
    return url;
  }

  const resolvedUrl = new URL(url, typeof window === "undefined" ? "http://localhost" : window.location.origin);
  resolvedUrl.searchParams.set(PIN_UNLOCK_QUERY_PARAM, token);

  if (/^https?:\/\//i.test(url)) {
    return resolvedUrl.toString();
  }

  return `${resolvedUrl.pathname}${resolvedUrl.search}${resolvedUrl.hash}`;
}

export function isPinAccessErrorCode(code: string | null | undefined): boolean {
  return code ? PIN_ACCESS_ERROR_CODES.has(code) : false;
}

export function dispatchPinLock(): void {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(new CustomEvent(PIN_LOCK_EVENT_NAME));
}
