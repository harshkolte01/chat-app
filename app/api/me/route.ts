import { NextRequest, NextResponse } from "next/server";
import { fail, ok, parseJsonBody } from "@/lib/api/responses";
import { serializePublicUser } from "@/lib/auth/current-user";
import { requirePinUnlockedApiUser } from "@/lib/auth/pin-access";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { setSessionCookie } from "@/lib/auth/session";
import { prisma } from "@/lib/db";

type UpdateProfileBody = {
  username?: string;
  email?: string;
  currentPassword?: string;
  newPassword?: string;
};

const USERNAME_REGEX = /^[a-zA-Z0-9_]{3,32}$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function GET(request: NextRequest) {
  const auth = await requirePinUnlockedApiUser(request);
  if (auth.response) {
    return auth.response;
  }
  const user = auth.user;

  return ok({
    user: serializePublicUser(user),
  });
}

export async function PATCH(request: NextRequest) {
  const auth = await requirePinUnlockedApiUser(request);
  if (auth.response) {
    return auth.response;
  }
  const currentUser = auth.user;

  const body = await parseJsonBody<UpdateProfileBody>(request);
  if (!body) {
    return fail(400, "INVALID_JSON", "Request body must be valid JSON.");
  }

  const nextUsername =
    body.username === undefined ? currentUser.username : body.username.trim();
  const nextEmail =
    body.email === undefined ? currentUser.email : normalizeEmail(body.email);
  const currentPassword = body.currentPassword ?? "";
  const newPassword = body.newPassword ?? "";

  const shouldUpdateUsername =
    body.username !== undefined && nextUsername !== currentUser.username;
  const shouldUpdateEmail =
    body.email !== undefined && nextEmail !== currentUser.email;
  const shouldUpdatePassword = newPassword.length > 0;

  if (body.username !== undefined && !USERNAME_REGEX.test(nextUsername)) {
    return fail(
      400,
      "INVALID_USERNAME",
      "Username must be 3-32 chars and use letters, numbers, or underscore.",
    );
  }

  if (body.email !== undefined && !EMAIL_REGEX.test(nextEmail)) {
    return fail(400, "INVALID_EMAIL", "Email format is invalid.");
  }

  if (currentPassword && !shouldUpdatePassword) {
    return fail(
      400,
      "INVALID_PASSWORD_UPDATE",
      "Provide a new password when current password is supplied.",
    );
  }

  if (shouldUpdatePassword && !currentPassword) {
    return fail(
      400,
      "CURRENT_PASSWORD_REQUIRED",
      "Current password is required to update your password.",
    );
  }

  if (shouldUpdatePassword && newPassword.length < MIN_PASSWORD_LENGTH) {
    return fail(
      400,
      "INVALID_PASSWORD",
      `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
    );
  }

  if (!shouldUpdateUsername && !shouldUpdateEmail && !shouldUpdatePassword) {
    return ok({
      user: serializePublicUser(currentUser),
    });
  }

  const storedUser = await prisma.user.findUnique({
    where: { id: currentUser.id },
    select: {
      id: true,
      username: true,
      email: true,
      passwordHash: true,
      createdAt: true,
    },
  });

  if (!storedUser) {
    return fail(401, "UNAUTHORIZED", "Authentication required.");
  }

  if (shouldUpdateUsername || shouldUpdateEmail) {
    const conflictChecks = [];

    if (shouldUpdateUsername) {
      conflictChecks.push({ username: nextUsername });
    }

    if (shouldUpdateEmail) {
      conflictChecks.push({
        email: {
          equals: nextEmail,
          mode: "insensitive" as const,
        },
      });
    }

    const conflictingUser = await prisma.user.findFirst({
      where: {
        id: { not: storedUser.id },
        OR: conflictChecks,
      },
      select: {
        username: true,
        email: true,
      },
    });

    if (shouldUpdateUsername && conflictingUser?.username === nextUsername) {
      return fail(409, "USERNAME_TAKEN", "Username is already in use.");
    }

    if (
      shouldUpdateEmail &&
      conflictingUser?.email &&
      normalizeEmail(conflictingUser.email) === nextEmail
    ) {
      return fail(409, "EMAIL_TAKEN", "Email is already in use.");
    }
  }

  const data: {
    username?: string;
    email?: string;
    passwordHash?: string;
  } = {};

  if (shouldUpdatePassword) {
    const validPassword = await verifyPassword(currentPassword, storedUser.passwordHash);
    if (!validPassword) {
      return fail(401, "INVALID_CREDENTIALS", "Current password is incorrect.");
    }

    data.passwordHash = await hashPassword(newPassword);
  }

  if (shouldUpdateUsername) {
    data.username = nextUsername;
  }

  if (shouldUpdateEmail) {
    data.email = nextEmail;
  }

  const updatedUser = await prisma.user.update({
    where: { id: storedUser.id },
    data,
    select: {
      id: true,
      username: true,
      email: true,
      createdAt: true,
    },
  });

  const response = NextResponse.json(
    {
      user: serializePublicUser(updatedUser),
    },
    { status: 200 },
  );

  setSessionCookie(response, {
    sub: updatedUser.id,
    username: updatedUser.username,
    email: updatedUser.email,
  });

  return response;
}
