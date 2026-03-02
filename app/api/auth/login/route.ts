import { NextResponse } from "next/server";
import { fail, parseJsonBody } from "@/lib/api/responses";
import { serializePublicUser } from "@/lib/auth/current-user";
import { verifyPassword } from "@/lib/auth/password";
import { setSessionCookie } from "@/lib/auth/session";
import { prisma } from "@/lib/db";

type LoginBody = {
  email?: string;
  password?: string;
};

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function POST(request: Request) {
  const body = await parseJsonBody<LoginBody>(request);
  if (!body) {
    return fail(400, "INVALID_JSON", "Request body must be valid JSON.");
  }

  const email = body.email ? normalizeEmail(body.email) : "";
  const password = body.password ?? "";

  if (!email || !password) {
    return fail(400, "MISSING_FIELDS", "email and password are required.");
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: {
      id: true,
      username: true,
      email: true,
      passwordHash: true,
      createdAt: true,
    },
  });

  if (!user) {
    return fail(401, "INVALID_CREDENTIALS", "Email or password is incorrect.");
  }

  const isValidPassword = await verifyPassword(password, user.passwordHash);
  if (!isValidPassword) {
    return fail(401, "INVALID_CREDENTIALS", "Email or password is incorrect.");
  }

  const response = NextResponse.json(
    {
      user: serializePublicUser(user),
    },
    { status: 200 },
  );

  setSessionCookie(response, {
    sub: user.id,
    username: user.username,
    email: user.email,
  });

  return response;
}
