import { NextRequest } from "next/server";
import { fail, ok } from "@/lib/api/responses";
import { serializePublicUser } from "@/lib/auth/current-user";
import { requirePinUnlockedApiUser } from "@/lib/auth/pin-access";
import { isConversationMember } from "@/lib/chat/membership";
import { prisma } from "@/lib/db";

const PAGE_SIZE = 30;

type MessageRecord = {
  id: string;
  conversationId: string;
  senderId: string;
  type: "TEXT" | "IMAGE";
  text: string | null;
  imageKey: string | null;
  status: "SENT" | "DELIVERED" | "READ";
  createdAt: Date;
  replyToMessage: {
    id: string;
    senderId: string;
    type: "TEXT" | "IMAGE";
    text: string | null;
    imageKey: string | null;
    createdAt: Date;
    sender: {
      username: string;
    };
  } | null;
  sender: {
    id: string;
    username: string;
    email: string;
    createdAt: Date;
  };
};

export async function GET(request: NextRequest) {
  const auth = await requirePinUnlockedApiUser(request);
  if (auth.response) {
    return auth.response;
  }
  const currentUser = auth.user;

  const conversationId = request.nextUrl.searchParams.get("conversationId")?.trim();
  const cursor = request.nextUrl.searchParams.get("cursor")?.trim() ?? null;

  if (!conversationId) {
    return fail(400, "MISSING_CONVERSATION_ID", "conversationId is required.");
  }

  const canAccess = await isConversationMember(conversationId, currentUser.id);
  if (!canAccess) {
    return fail(403, "FORBIDDEN", "You do not have access to this conversation.");
  }

  let cursorMessage: { id: string; createdAt: Date } | null = null;
  if (cursor) {
    cursorMessage = await prisma.message.findFirst({
      where: {
        id: cursor,
        conversationId,
      },
      select: {
        id: true,
        createdAt: true,
      },
    });

    if (!cursorMessage) {
      return fail(400, "INVALID_CURSOR", "Cursor is invalid for this conversation.");
    }
  }

  const where: Record<string, unknown> = { conversationId };

  if (cursorMessage) {
    where.OR = [
      {
        createdAt: { lt: cursorMessage.createdAt },
      },
      {
        AND: [
          { createdAt: cursorMessage.createdAt },
          { id: { lt: cursorMessage.id } },
        ],
      },
    ];
  }

  const messages = (await prisma.message.findMany({
    where,
    take: PAGE_SIZE,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    include: {
      replyToMessage: {
        select: {
          id: true,
          senderId: true,
          type: true,
          text: true,
          imageKey: true,
          createdAt: true,
          sender: {
            select: {
              username: true,
            },
          },
        },
      },
      sender: {
        select: {
          id: true,
          username: true,
          email: true,
          createdAt: true,
        },
      },
    },
  })) as MessageRecord[];

  const nextCursor = messages.length === PAGE_SIZE ? messages[messages.length - 1].id : null;

  return ok({
    messages: messages.map((message) => ({
      id: message.id,
      conversationId: message.conversationId,
      senderId: message.senderId,
      sender: serializePublicUser(message.sender),
      type: message.type,
      text: message.text,
      imageKey: message.imageKey,
      replyTo: message.replyToMessage
        ? {
            id: message.replyToMessage.id,
            senderId: message.replyToMessage.senderId,
            senderUsername: message.replyToMessage.sender.username,
            type: message.replyToMessage.type,
            text: message.replyToMessage.text,
            imageKey: message.replyToMessage.imageKey,
            createdAt: message.replyToMessage.createdAt.toISOString(),
          }
        : null,
      status: message.status,
      createdAt: message.createdAt.toISOString(),
    })),
    nextCursor,
  });
}
