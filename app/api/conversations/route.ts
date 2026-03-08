import { NextRequest } from "next/server";
import { fail, ok, parseJsonBody } from "@/lib/api/responses";
import { requirePinUnlockedApiUser } from "@/lib/auth/pin-access";
import { listConversationSummaries } from "@/lib/chat/conversation-summaries";
import { prisma } from "@/lib/db";

type CreateConversationBody = {
  otherUserId?: string;
  username?: string;
};

function getPairIds(firstUserId: string, secondUserId: string): [string, string] {
  return firstUserId < secondUserId
    ? [firstUserId, secondUserId]
    : [secondUserId, firstUserId];
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}

export async function GET(request: NextRequest) {
  const auth = await requirePinUnlockedApiUser(request);
  if (auth.response) {
    return auth.response;
  }
  const currentUser = auth.user;

  const conversations = await listConversationSummaries(currentUser.id);
  return ok({ conversations });
}

export async function POST(request: NextRequest) {
  const auth = await requirePinUnlockedApiUser(request);
  if (auth.response) {
    return auth.response;
  }
  const currentUser = auth.user;

  const body = await parseJsonBody<CreateConversationBody>(request);
  if (!body) {
    return fail(400, "INVALID_JSON", "Request body must be valid JSON.");
  }

  const otherUserId = body.otherUserId?.trim();
  const username = body.username?.trim();

  if (!otherUserId && !username) {
    return fail(400, "MISSING_FIELDS", "Provide either otherUserId or username.");
  }

  const otherUser = otherUserId
    ? await prisma.user.findUnique({
        where: { id: otherUserId },
        select: { id: true },
      })
    : await prisma.user.findUnique({
        where: { username },
        select: { id: true },
      });

  if (!otherUser) {
    return fail(404, "USER_NOT_FOUND", "Could not find the requested user.");
  }

  if (otherUser.id === currentUser.id) {
    return fail(400, "INVALID_TARGET", "Cannot create a conversation with yourself.");
  }

  const [userAId, userBId] = getPairIds(currentUser.id, otherUser.id);
  const uniquePair = { userAId, userBId };

  let created = false;
  let conversationId: string;

  const existingConversation = await prisma.conversation.findUnique({
    where: { userAId_userBId: uniquePair },
    select: { id: true },
  });

  if (existingConversation) {
    conversationId = existingConversation.id;
  } else {
    try {
      const conversation = await prisma.conversation.create({
        data: uniquePair,
        select: { id: true },
      });
      conversationId = conversation.id;
      created = true;
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        const raceWinner = await prisma.conversation.findUnique({
          where: { userAId_userBId: uniquePair },
          select: { id: true },
        });
        if (!raceWinner) {
          return fail(500, "INTERNAL_ERROR", "Failed to create conversation.");
        }
        conversationId = raceWinner.id;
      } else {
        return fail(500, "INTERNAL_ERROR", "Failed to create conversation.");
      }
    }
  }

  const now = new Date();
  await prisma.$transaction([
    prisma.userConversation.upsert({
      where: {
        conversationId_userId: {
          conversationId,
          userId: currentUser.id,
        },
      },
      update: {},
      create: {
        conversationId,
        userId: currentUser.id,
        lastReadAt: now,
      },
    }),
    prisma.userConversation.upsert({
      where: {
        conversationId_userId: {
          conversationId,
          userId: otherUser.id,
        },
      },
      update: {},
      create: {
        conversationId,
        userId: otherUser.id,
        lastReadAt: now,
      },
    }),
  ]);

  return ok(
    {
      conversationId,
      created,
    },
    created ? 201 : 200,
  );
}
