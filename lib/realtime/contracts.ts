export const REALTIME_TOKEN_INVALID_CODE = "REALTIME_TOKEN_INVALID";
export const REALTIME_TOKEN_EXPIRED_CODE = "REALTIME_TOKEN_EXPIRED";

export type RealtimeTokenErrorCode =
  | typeof REALTIME_TOKEN_INVALID_CODE
  | typeof REALTIME_TOKEN_EXPIRED_CODE;

export type RealtimeTokenResponse = {
  realtimeToken: string;
  expiresIn: number;
};

const REALTIME_TOKEN_REFRESH_ERROR_CODES = new Set<RealtimeTokenErrorCode>([
  REALTIME_TOKEN_INVALID_CODE,
  REALTIME_TOKEN_EXPIRED_CODE,
]);

export function isRealtimeTokenRefreshErrorCode(
  code: string | null | undefined,
): code is RealtimeTokenErrorCode {
  return code ? REALTIME_TOKEN_REFRESH_ERROR_CODES.has(code as RealtimeTokenErrorCode) : false;
}
