const DEFAULT_ICE_SERVERS: RTCIceServer[] = [
  {
    urls: ["stun:stun.l.google.com:19302"],
  },
];

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isRtcIceServer(value: unknown): value is RTCIceServer {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<RTCIceServer>;
  if (Array.isArray(candidate.urls)) {
    return candidate.urls.every((entry) => isNonEmptyString(entry));
  }

  return isNonEmptyString(candidate.urls);
}

export function getWebRtcIceServers(): RTCIceServer[] {
  const raw = process.env.NEXT_PUBLIC_WEBRTC_ICE_SERVERS_JSON?.trim();
  if (!raw) {
    return DEFAULT_ICE_SERVERS;
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return DEFAULT_ICE_SERVERS;
    }

    const normalized = parsed.filter(isRtcIceServer).map((server) => ({
      urls: server.urls,
      username: typeof server.username === "string" ? server.username : undefined,
      credential: typeof server.credential === "string" ? server.credential : undefined,
    }));

    return normalized.length > 0 ? normalized : DEFAULT_ICE_SERVERS;
  } catch {
    return DEFAULT_ICE_SERVERS;
  }
}
