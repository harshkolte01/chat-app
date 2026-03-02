import { NextResponse } from "next/server";
import { fail, parseJsonBody } from "@/lib/api/responses";
import { serializePublicUser } from "@/lib/auth/current-user";
import { hashPassword } from "@/lib/auth/password";
import { setSessionCookie } from "@/lib/auth/session";
import { prisma } from "@/lib/db";

type SignupBody = {
  username?: string;
  email?: string;
  password?: string;
  accessCode?: string;
};

const USERNAME_REGEX = /^[a-zA-Z0-9_]{3,32}$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function POST(request: Request) {
  const body = await parseJsonBody<SignupBody>(request);
  if (!body) {
    return fail(400, "INVALID_JSON", "Request body must be valid JSON.");
  }

  const username = body.username?.trim();
  const email = body.email ? normalizeEmail(body.email) : "";
  const password = body.password ?? "";
  const accessCode = body.accessCode ?? "";

  if (!username || !email || !password || !accessCode) {
    return fail(
      400,
      "MISSING_FIELDS",
      "username, email, password, and accessCode are required.",
    );
  }

  if (!USERNAME_REGEX.test(username)) {
    return fail(
      400,
      "INVALID_USERNAME",
      "Username must be 3-32 chars and use letters, numbers, or underscore.",
    );
  }

  if (!EMAIL_REGEX.test(email)) {
    return fail(400, "INVALID_EMAIL", "Email format is invalid.");
  }

  if (password.length < MIN_PASSWORD_LENGTH) {
    return fail(
      400,
      "INVALID_PASSWORD",
      `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
    );
  }

  if (!process.env.INVITE_CODE) {
    return fail(500, "SERVER_CONFIG_ERROR", "INVITE_CODE is not configured.");
  }

  if (accessCode !== process.env.INVITE_CODE) {
    return fail(401, "INVALID_ACCESS_CODE", "Access code is invalid.");
  }

  const existingUser = await prisma.user.findFirst({
    where: {
      OR: [{ username }, { email }],
    },
    select: { username: true, email: true },
  });

  if (existingUser?.username === username) {
    return fail(409, "USERNAME_TAKEN", "Username is already in use.");
  }

  if (existingUser?.email === email) {
    return fail(409, "EMAIL_TAKEN", "Email is already in use.");
  }

  try {
    const passwordHash = await hashPassword(password);
    const user = await prisma.user.create({
      data: {
        username,
        email,
        passwordHash,
      },
      select: {
        id: true,
        username: true,
        email: true,
        createdAt: true,
      },
    });

    const response = NextResponse.json(
      {
        user: serializePublicUser(user),
      },
      { status: 201 },
    );

    setSessionCookie(response, {
      sub: user.id,
      username: user.username,
      email: user.email,
    });

    return response;
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return fail(409, "USER_ALREADY_EXISTS", "Username or email is already in use.");
    }

    return fail(500, "INTERNAL_ERROR", "Failed to create account.");
  }
}
