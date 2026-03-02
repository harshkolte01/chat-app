import { NextRequest } from "next/server";
import { fail, ok } from "@/lib/api/responses";
import { getCurrentUserFromRequest, serializePublicUser } from "@/lib/auth/current-user";
import { prisma } from "@/lib/db";

const MAX_USERS = 20;

export async function GET(request: NextRequest) {
  const currentUser = await getCurrentUserFromRequest(request);
  if (!currentUser) {
    return fail(401, "UNAUTHORIZED", "Authentication required.");
  }

  const query = request.nextUrl.searchParams.get("query")?.trim();

  const users = await prisma.user.findMany({
    where: {
      id: { not: currentUser.id },
      ...(query
        ? {
            OR: [
              { username: { contains: query, mode: "insensitive" } },
              { email: { contains: query, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    orderBy: [{ username: "asc" }],
    take: MAX_USERS,
    select: {
      id: true,
      username: true,
      email: true,
      createdAt: true,
    },
  });

  return ok({
    users: users.map((user) => serializePublicUser(user)),
  });
}
