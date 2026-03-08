import { NextRequest } from "next/server";
import { ok } from "@/lib/api/responses";
import { requirePinUnlockedApiUser } from "@/lib/auth/pin-access";
import { RealtimeTokenResponse } from "@/lib/realtime/contracts";
import { createRealtimeToken, getRealtimeTokenTtlSeconds } from "@/lib/realtime/token";

export async function POST(request: NextRequest) {
  const auth = await requirePinUnlockedApiUser(request);
  if (auth.response) {
    return auth.response;
  }

  const response: RealtimeTokenResponse = {
    realtimeToken: createRealtimeToken({
      sub: auth.user.id,
      email: auth.user.email,
      username: auth.user.username,
      pinVersion: auth.user.pinVersion,
    }),
    expiresIn: getRealtimeTokenTtlSeconds(),
  };

  return ok(response);
}
