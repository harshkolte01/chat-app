import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionFromRequest, getSessionFromServerCookies } from "@/lib/auth/session";

const publicUserSelect = {
  id: true,
  username: true,
  email: true,
  createdAt: true,
} as const;

export type PublicUser = {
  id: string;
  username: string;
  email: string;
  createdAt: string;
};

export type PublicUserDbShape = {
  id: string;
  username: string;
  email: string;
  createdAt: Date;
};

export function serializePublicUser(user: PublicUserDbShape): PublicUser {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    createdAt: user.createdAt.toISOString(),
  };
}

async function findPublicUserById(userId: string): Promise<PublicUserDbShape | null> {
  return prisma.user.findUnique({
    where: { id: userId },
    select: publicUserSelect,
  });
}

export async function getCurrentUserFromRequest(
  request: NextRequest,
): Promise<PublicUserDbShape | null> {
  const session = getSessionFromRequest(request);
  if (!session) {
    return null;
  }

  return findPublicUserById(session.sub);
}

export async function getCurrentUserFromCookies(): Promise<PublicUserDbShape | null> {
  const session = await getSessionFromServerCookies();
  if (!session) {
    return null;
  }

  return findPublicUserById(session.sub);
}
