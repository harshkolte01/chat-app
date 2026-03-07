import { NextRequest } from "next/server";
import { fail, ok } from "@/lib/api/responses";
import { getCurrentUserFromRequest, serializePublicUser } from "@/lib/auth/current-user";
import { prisma } from "@/lib/db";

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function GET(request: NextRequest) {
  const currentUser = await getCurrentUserFromRequest(request);
  if (!currentUser) {
    return fail(401, "UNAUTHORIZED", "Authentication required.");
  }

  const emailParam =
    request.nextUrl.searchParams.get("email") ?? request.nextUrl.searchParams.get("query");
  const email = emailParam ? normalizeEmail(emailParam) : "";

  if (!email) {
    return ok({ users: [] });
  }

  const user = await prisma.user.findFirst({
    where: {
      id: { not: currentUser.id },
      email: { equals: email, mode: "insensitive" },
    },
    select: {
      id: true,
      username: true,
      email: true,
      createdAt: true,
    },
  });

  return ok({
    users: user ? [serializePublicUser(user)] : [],
  });
}
