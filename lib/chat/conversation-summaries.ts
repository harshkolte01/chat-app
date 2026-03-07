import { Prisma } from "@prisma/client";
import { PublicUser, PublicUserDbShape, serializePublicUser } from "@/lib/auth/current-user";
import { prisma } from "@/lib/db";

type ConversationUserRecord = PublicUserDbShape;

type ConversationMessageRecord = {
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
  userA: ConversationUserRecord;
  userB: ConversationUserRecord;
  messages: ConversationMessageRecord[];
};

type UnreadConversationMetaRow = {
  conversationId: string;
  unreadCount: number;
  latestUnreadMessageId: string | null;
  latestUnreadSenderId: string | null;
  latestUnreadSenderUsername: string | null;
  latestUnreadType: "TEXT" | "IMAGE" | null;
  latestUnreadTextPreview: string | null;
  latestUnreadCreatedAt: Date | null;
};

export type ConversationSummary = {
  id: string;
  otherUser: PublicUser;
  lastActivityAt: string;
  lastMessage: {
    id: string;
    senderId: string;
    type: "TEXT" | "IMAGE";
    status: "SENT" | "DELIVERED" | "READ";
    textPreview: string;
    createdAt: string;
  } | null;
  unreadCount: number;
  latestUnreadMessage: {
    id: string;
    senderId: string;
    senderUsername: string;
    type: "TEXT" | "IMAGE";
    textPreview: string;
    createdAt: string;
  } | null;
};

async function getUnreadConversationMeta(
  currentUserId: string,
): Promise<Map<string, UnreadConversationMetaRow>> {
  // LATERAL join keeps unread count and latest unread preview in one query per conversation list load.
  const rows = await prisma.$queryRaw<UnreadConversationMetaRow[]>(Prisma.sql`
    SELECT
      c.id AS "conversationId",
      COUNT(unread.id)::int AS "unreadCount",
      latest.id AS "latestUnreadMessageId",
      latest."senderId" AS "latestUnreadSenderId",
      latest."senderUsername" AS "latestUnreadSenderUsername",
      latest.type AS "latestUnreadType",
      latest."textPreview" AS "latestUnreadTextPreview",
      latest."createdAt" AS "latestUnreadCreatedAt"
    FROM "Conversation" c
    LEFT JOIN "UserConversation" uc
      ON uc."conversationId" = c.id
     AND uc."userId" = ${currentUserId}
    LEFT JOIN "Message" unread
      ON unread."conversationId" = c.id
     AND unread."senderId" <> ${currentUserId}
     AND unread."createdAt" > COALESCE(uc."lastReadAt", TIMESTAMP 'epoch')
    LEFT JOIN LATERAL (
      SELECT
        m.id,
        m."senderId",
        sender.username AS "senderUsername",
        m.type::text AS type,
        CASE
          WHEN m.type = 'TEXT' THEN COALESCE(m.text, '')
          ELSE '[image]'
        END AS "textPreview",
        m."createdAt"
      FROM "Message" m
      INNER JOIN "User" sender
        ON sender.id = m."senderId"
      WHERE m."conversationId" = c.id
        AND m."senderId" <> ${currentUserId}
        AND m."createdAt" > COALESCE(uc."lastReadAt", TIMESTAMP 'epoch')
      ORDER BY m."createdAt" DESC, m.id DESC
      LIMIT 1
    ) latest ON true
    WHERE c."userAId" = ${currentUserId}
       OR c."userBId" = ${currentUserId}
    GROUP BY
      c.id,
      latest.id,
      latest."senderId",
      latest."senderUsername",
      latest.type,
      latest."textPreview",
      latest."createdAt"
  `);

  return new Map(rows.map((row) => [row.conversationId, row]));
}

export async function listConversationSummaries(
  currentUserId: string,
): Promise<ConversationSummary[]> {
  const [conversations, unreadMetaByConversationId] = await Promise.all([
    prisma.conversation.findMany({
      where: {
        OR: [{ userAId: currentUserId }, { userBId: currentUserId }],
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
    }) as Promise<ConversationRecord[]>,
    getUnreadConversationMeta(currentUserId),
  ]);

  return conversations
    .map((conversation) => {
      const otherUser =
        conversation.userAId === currentUserId ? conversation.userB : conversation.userA;
      const lastMessage = conversation.messages[0] ?? null;
      const lastActivity = lastMessage?.createdAt ?? conversation.createdAt;
      const unreadMeta = unreadMetaByConversationId.get(conversation.id);

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
              textPreview: lastMessage.type === "TEXT" ? (lastMessage.text ?? "") : "[image]",
              createdAt: lastMessage.createdAt.toISOString(),
            }
          : null,
        unreadCount: unreadMeta?.unreadCount ?? 0,
        latestUnreadMessage:
          unreadMeta?.latestUnreadMessageId &&
          unreadMeta.latestUnreadSenderId &&
          unreadMeta.latestUnreadSenderUsername &&
          unreadMeta.latestUnreadType &&
          unreadMeta.latestUnreadTextPreview !== null &&
          unreadMeta.latestUnreadCreatedAt
            ? {
                id: unreadMeta.latestUnreadMessageId,
                senderId: unreadMeta.latestUnreadSenderId,
                senderUsername: unreadMeta.latestUnreadSenderUsername,
                type: unreadMeta.latestUnreadType,
                textPreview: unreadMeta.latestUnreadTextPreview,
                createdAt: unreadMeta.latestUnreadCreatedAt.toISOString(),
              }
            : null,
      };
    })
    .sort(
      (left, right) =>
        new Date(right.lastActivityAt).getTime() - new Date(left.lastActivityAt).getTime(),
    );
}
