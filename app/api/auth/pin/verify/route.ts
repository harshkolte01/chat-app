import { NextRequest } from "next/server";
import { fail, ok, parseJsonBody } from "@/lib/api/responses";
import { getCurrentAuthenticatedUserFromRequest } from "@/lib/auth/current-user";
import { verifyPassword } from "@/lib/auth/password";
import { createPinUnlockToken, isValidPin, normalizePin } from "@/lib/auth/pin";

type VerifyPinBody = {
  pin?: string;
};

export async function POST(request: NextRequest) {
  const currentUser = await getCurrentAuthenticatedUserFromRequest(request);
  if (!currentUser) {
    return fail(401, "UNAUTHORIZED", "Authentication required.");
  }

  if (!currentUser.pinHash) {
    return fail(423, "PIN_SETUP_REQUIRED", "Set up your PIN before unlocking chats.");
  }

  const body = await parseJsonBody<VerifyPinBody>(request);
  if (!body) {
    return fail(400, "INVALID_JSON", "Request body must be valid JSON.");
  }

  const pin = normalizePin(body.pin ?? "");
  if (!isValidPin(pin)) {
    return fail(400, "INVALID_PIN_FORMAT", "PIN must be exactly 6 digits.");
  }

  const isValidPinMatch = await verifyPassword(pin, currentUser.pinHash);
  if (!isValidPinMatch) {
    return fail(401, "INVALID_PIN", "PIN is incorrect.");
  }

  return ok({
    pinConfigured: true,
    pinUnlockToken: createPinUnlockToken({
      sub: currentUser.id,
      pinVersion: currentUser.pinVersion,
    }),
  });
}
