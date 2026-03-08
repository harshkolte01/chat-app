import type { MessageReadPayload } from "../socket/contracts";
import { prisma } from "../db";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type ConversationMemberRecord = {
  id: string;
  userAId: string;
  userBId: string;
};

export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

export async function getConversationForMember(
  conversationId: string,
  userId: string,
): Promise<ConversationMemberRecord | null> {
  return prisma.conversation.findFirst({
    where: {
      id: conversationId,
      OR: [{ userAId: userId }, { userBId: userId }],
    },
    select: {
      id: true,
      userAId: true,
      userBId: true,
    },
  });
}

export async function resolveReadTimestamp(
  payload: MessageReadPayload,
): Promise<{ timestamp: Date; valid: boolean }> {
  const lastReadMessageId = payload.lastReadMessageId?.trim();
  if (lastReadMessageId) {
    if (!isUuid(lastReadMessageId)) {
      return { timestamp: new Date(), valid: false };
    }

    const message = await prisma.message.findUnique({
      where: { id: lastReadMessageId },
      select: {
        conversationId: true,
        createdAt: true,
      },
    });

    if (!message || message.conversationId !== payload.conversationId) {
      return { timestamp: new Date(), valid: false };
    }

    return { timestamp: message.createdAt, valid: true };
  }

  const timestampValue = payload.timestamp?.trim();
  if (timestampValue) {
    const parsed = new Date(timestampValue);
    if (Number.isNaN(parsed.getTime())) {
      return { timestamp: new Date(), valid: false };
    }

    return { timestamp: parsed, valid: true };
  }

  return { timestamp: new Date(), valid: true };
}

export async function applyConversationReadState(params: {
  conversation: ConversationMemberRecord;
  userId: string;
  readAt: Date;
}): Promise<{ unreadIds: string[]; participantIds: string[] }> {
  const { conversation, readAt, userId } = params;

  await prisma.userConversation.upsert({
    where: {
      conversationId_userId: {
        conversationId: conversation.id,
        userId,
      },
    },
    update: {
      lastReadAt: readAt,
    },
    create: {
      conversationId: conversation.id,
      userId,
      lastReadAt: readAt,
    },
  });

  const unreadMessages = await prisma.message.findMany({
    where: {
      conversationId: conversation.id,
      senderId: { not: userId },
      createdAt: { lte: readAt },
      status: { in: ["SENT", "DELIVERED"] },
    },
    select: { id: true },
  });

  const unreadIds = unreadMessages.map((message) => message.id);
  if (unreadIds.length > 0) {
    await prisma.message.updateMany({
      where: {
        id: { in: unreadIds },
      },
      data: {
        status: "READ",
      },
    });
  }

  return {
    unreadIds,
    participantIds: [conversation.userAId, conversation.userBId],
  };
}
