import { NextRequest } from "next/server";
import { fail, ok, parseJsonBody } from "@/lib/api/responses";
import { getCurrentAuthenticatedUserFromRequest, serializePublicUser } from "@/lib/auth/current-user";
import { hashPassword } from "@/lib/auth/password";
import { createPinUnlockToken, isValidPin, normalizePin } from "@/lib/auth/pin";
import { prisma } from "@/lib/db";

type SetupPinBody = {
  pin?: string;
  confirmPin?: string;
};

export async function POST(request: NextRequest) {
  const currentUser = await getCurrentAuthenticatedUserFromRequest(request);
  if (!currentUser) {
    return fail(401, "UNAUTHORIZED", "Authentication required.");
  }

  if (currentUser.pinHash) {
    return fail(409, "PIN_ALREADY_CONFIGURED", "PIN is already configured for this account.");
  }

  const body = await parseJsonBody<SetupPinBody>(request);
  if (!body) {
    return fail(400, "INVALID_JSON", "Request body must be valid JSON.");
  }

  const pin = normalizePin(body.pin ?? "");
  const confirmPin = normalizePin(body.confirmPin ?? "");

  if (!pin || !confirmPin) {
    return fail(400, "MISSING_FIELDS", "pin and confirmPin are required.");
  }

  if (!isValidPin(pin)) {
    return fail(400, "INVALID_PIN_FORMAT", "PIN must be exactly 6 digits.");
  }

  if (pin !== confirmPin) {
    return fail(400, "PIN_MISMATCH", "PIN and confirm PIN must match.");
  }

  const pinHash = await hashPassword(pin);
  const updatedUser = await prisma.user.update({
    where: { id: currentUser.id },
    data: {
      pinHash,
      pinVersion: {
        increment: 1,
      },
      pinUpdatedAt: new Date(),
    },
    select: {
      id: true,
      username: true,
      email: true,
      createdAt: true,
      pinVersion: true,
    },
  });

  return ok({
    user: serializePublicUser(updatedUser),
    pinConfigured: true,
    pinUnlockToken: createPinUnlockToken({
      sub: updatedUser.id,
      pinVersion: updatedUser.pinVersion,
    }),
  });
}
