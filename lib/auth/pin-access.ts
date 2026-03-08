import { NextRequest, NextResponse } from "next/server";
import { fail } from "@/lib/api/responses";
import {
  AuthenticatedUserDbShape,
  getCurrentAuthenticatedUserFromRequest,
} from "@/lib/auth/current-user";
import { getPinUnlockTokenFromRequest, isValidPinUnlockForUser } from "@/lib/auth/pin";

type PinApiAuthSuccess = {
  user: AuthenticatedUserDbShape;
  response: null;
};

type PinApiAuthFailure = {
  user: null;
  response: NextResponse;
};

export type PinApiAuthResult = PinApiAuthSuccess | PinApiAuthFailure;

function createPinSetupRequiredResponse() {
  return fail(
    423,
    "PIN_SETUP_REQUIRED",
    "Set up your PIN before accessing chats and messages.",
  );
}

function createPinUnlockRequiredResponse() {
  return fail(
    423,
    "PIN_UNLOCK_REQUIRED",
    "Enter your PIN to unlock chats and messages.",
  );
}

export async function requirePinUnlockedApiUser(
  request: NextRequest,
): Promise<PinApiAuthResult> {
  const currentUser = await getCurrentAuthenticatedUserFromRequest(request);
  if (!currentUser) {
    return {
      user: null,
      response: fail(401, "UNAUTHORIZED", "Authentication required."),
    };
  }

  if (!currentUser.pinHash) {
    return {
      user: null,
      response: createPinSetupRequiredResponse(),
    };
  }

  const unlockToken = getPinUnlockTokenFromRequest(request);
  if (!isValidPinUnlockForUser(currentUser, unlockToken)) {
    return {
      user: null,
      response: createPinUnlockRequiredResponse(),
    };
  }

  return {
    user: currentUser,
    response: null,
  };
}
