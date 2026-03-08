export const DEFAULT_REALTIME_SOCKET_PATH = "/socket.io";
export const DEFAULT_REALTIME_SERVER_URL = "http://127.0.0.1:3001";

export function normalizeRealtimeSocketPath(value: string | null | undefined): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    return DEFAULT_REALTIME_SOCKET_PATH;
  }

  if (trimmed.startsWith("/")) {
    return trimmed;
  }

  return `/${trimmed}`;
}

export function getRealtimeSocketPath(): string {
  return normalizeRealtimeSocketPath(process.env.NEXT_PUBLIC_REALTIME_SOCKET_PATH);
}

export function getRealtimeServerUrl(): string | null {
  const configuredUrl = process.env.NEXT_PUBLIC_REALTIME_URL?.trim();
  if (configuredUrl) {
    try {
      return new URL(configuredUrl).toString().replace(/\/$/, "");
    } catch {
      return null;
    }
  }

  if (process.env.NODE_ENV !== "production") {
    return DEFAULT_REALTIME_SERVER_URL;
  }

  return null;
}
