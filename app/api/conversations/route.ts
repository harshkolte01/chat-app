import { NextRequest } from "next/server";
import { fail, ok, parseJsonBody } from "@/lib/api/responses";
import { getCurrentUserFromRequest, serializePublicUser } from "@/lib/auth/current-user";
import { prisma } from "@/lib/db";

type CreateConversationBody = {
  otherUserId?: string;
  username?: string;
};

type ConversationUser = {
  id: string;
  username: string;
  email: string;
  createdAt: Date;
};

type ConversationMessage = {
  id: string;
  type: "TEXT" | "IMAGE";
  text: string | null;
  imageKey: string | null;
  senderId: string;
  status: "SENT" | "DELIVERED" | "READ";
  createdAt: Date;
};

type ConversationRecord = {
  id: string;
  userAId: string;
  userBId: string;
  createdAt: Date;
  userA: ConversationUser;
  userB: ConversationUser;
  messages: ConversationMessage[];
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
  const currentUser = await getCurrentUserFromRequest(request);
  if (!currentUser) {
    return fail(401, "UNAUTHORIZED", "Authentication required.");
  }

  const conversations = (await prisma.conversation.findMany({
    where: {
      OR: [{ userAId: currentUser.id }, { userBId: currentUser.id }],
    },
    include: {
      userA: {
        select: {
          id: true,
          username: true,
          email: true,
          createdAt: true,
        },
      },
      userB: {
        select: {
          id: true,
          username: true,
          email: true,
          createdAt: true,
        },
      },
      messages: {
        take: 1,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: {
          id: true,
          type: true,
          text: true,
          imageKey: true,
          senderId: true,
          status: true,
          createdAt: true,
        },
      },
    },
  })) as ConversationRecord[];

  const serializedConversations = conversations
    .map((conversation) => {
      const otherUser =
        conversation.userAId === currentUser.id ? conversation.userB : conversation.userA;
      const lastMessage = conversation.messages[0] ?? null;
      const lastActivity = lastMessage?.createdAt ?? conversation.createdAt;

      return {
        id: conversation.id,
        otherUser: serializePublicUser(otherUser),
        lastActivityAt: lastActivity.toISOString(),
        lastMessage: lastMessage
          ? {
              id: lastMessage.id,
              senderId: lastMessage.senderId,
              type: lastMessage.type,
              status: lastMessage.status,
              textPreview:
                lastMessage.type === "TEXT"
                  ? (lastMessage.text ?? "")
                  : (lastMessage.imageKey ?? "[image]"),
              createdAt: lastMessage.createdAt.toISOString(),
            }
          : null,
      };
    })
    .sort(
      (a, b) =>
        new Date(b.lastActivityAt).getTime() - new Date(a.lastActivityAt).getTime(),
    );

  return ok({ conversations: serializedConversations });
}

export async function POST(request: NextRequest) {
  const currentUser = await getCurrentUserFromRequest(request);
  if (!currentUser) {
    return fail(401, "UNAUTHORIZED", "Authentication required.");
  }

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
