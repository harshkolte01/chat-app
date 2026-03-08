import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionFromRequest, getSessionFromServerCookies } from "@/lib/auth/session";

const publicUserSelect = {
  id: true,
  username: true,
  email: true,
  createdAt: true,
} as const;

const authenticatedUserSelect = {
  ...publicUserSelect,
  pinHash: true,
  pinVersion: true,
  pinUpdatedAt: true,
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

export type AuthenticatedUserDbShape = PublicUserDbShape & {
  pinHash: string | null;
  pinVersion: number;
  pinUpdatedAt: Date | null;
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

async function findAuthenticatedUserById(userId: string): Promise<AuthenticatedUserDbShape | null> {
  return prisma.user.findUnique({
    where: { id: userId },
    select: authenticatedUserSelect,
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

export async function getCurrentAuthenticatedUserFromRequest(
  request: NextRequest,
): Promise<AuthenticatedUserDbShape | null> {
  const session = getSessionFromRequest(request);
  if (!session) {
    return null;
  }

  return findAuthenticatedUserById(session.sub);
}

export async function getCurrentAuthenticatedUserFromCookies(): Promise<AuthenticatedUserDbShape | null> {
  const session = await getSessionFromServerCookies();
  if (!session) {
    return null;
  }

  return findAuthenticatedUserById(session.sub);
}
