import type { Server as HttpServer } from "node:http";
import { Server as SocketIOServer, Socket } from "socket.io";
import { AUTH_COOKIE_NAME } from "@/lib/auth/constants";
import { verifySessionToken } from "@/lib/auth/jwt";
import {
  applyConversationReadState,
  getConversationForMember,
  resolveReadTimestamp,
} from "@/lib/chat/read-state";
import { prisma } from "@/lib/db";
import {
  ChatMessageStatusUpdatedEvent,
  ChatNewMessageEvent,
  ChatMessageType,
  ClientToServerEvents,
  MessageDeliveredPayload,
  MessageReadPayload,
  SendMessagePayload,
  ServerToClientEvents,
  SocketAckResponse,
  SocketData,
  SocketErrorPayload,
  SocketMessage,
  SocketPublicUser,
  SocketReplyMessage,
} from "@/lib/socket/contracts";

type SocketServer = SocketIOServer<ClientToServerEvents, ServerToClientEvents, object, SocketData>;
type AuthenticatedSocket = Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  object,
  SocketData
>;

const MESSAGE_TEXT_LIMIT = 4000;
const DELIVERY_ACK_TIMEOUT_MS = Number(process.env.SOCKET_DELIVERY_ACK_TIMEOUT_MS ?? 10_000);
const pendingDeliveryAcks = new Map<string, NodeJS.Timeout>();
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

function createSocketError(code: string, message: string): SocketErrorPayload {
  return { code, message };
}

function ackSuccess<T>(ack: ((response: SocketAckResponse<T>) => void) | undefined, data?: T) {
  if (!ack) {
    return;
  }

  if (data === undefined) {
    ack({ ok: true } as SocketAckResponse<T>);
    return;
  }

  ack({ ok: true, data });
}

function ackError<T>(
  ack: ((response: SocketAckResponse<T>) => void) | undefined,
  code: string,
  message: string,
) {
  if (!ack) {
    return;
  }

  ack({
    ok: false,
    error: createSocketError(code, message),
  });
}

function parseCookie(header: string): Record<string, string> {
  return header
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce<Record<string, string>>((result, part) => {
      const separatorIndex = part.indexOf("=");
      if (separatorIndex <= 0) {
        return result;
      }

      const name = part.slice(0, separatorIndex).trim();
      const value = part.slice(separatorIndex + 1).trim();
      if (!name) {
        return result;
      }

      result[name] = decodeURIComponent(value);
      return result;
    }, {});
}

function parseIncomingMessageType(type: SendMessagePayload["type"]): ChatMessageType | null {
  const normalized = String(type ?? "").trim().toUpperCase();
  if (normalized === "TEXT" || normalized === "IMAGE") {
    return normalized;
  }
  return null;
}

function clearPendingDeliveryAck(messageId: string) {
  const timer = pendingDeliveryAcks.get(messageId);
  if (!timer) {
    return;
  }

  clearTimeout(timer);
  pendingDeliveryAcks.delete(messageId);
}

function registerPendingDeliveryAck(messageId: string) {
  clearPendingDeliveryAck(messageId);

  const timer = setTimeout(() => {
    pendingDeliveryAcks.delete(messageId);
  }, DELIVERY_ACK_TIMEOUT_MS);

  pendingDeliveryAcks.set(messageId, timer);
}

function userRoom(userId: string): string {
  return `user:${userId}`;
}

type SocketReplySource = {
  id: string;
  senderId: string;
  type: ChatMessageType;
  text: string | null;
  imageKey: string | null;
  createdAt: Date;
  sender: {
    username: string;
  };
} | null;

function toSocketReplyMessage(replyTo: SocketReplySource): SocketReplyMessage | null {
  if (!replyTo) {
    return null;
  }

  return {
    id: replyTo.id,
    senderId: replyTo.senderId,
    senderUsername: replyTo.sender.username,
    type: replyTo.type,
    text: replyTo.text,
    imageKey: replyTo.imageKey,
    createdAt: replyTo.createdAt.toISOString(),
  };
}

function toSocketMessage(message: {
  id: string;
  conversationId: string;
  senderId: string;
  type: ChatMessageType;
  text: string | null;
  imageKey: string | null;
  replyToMessage: SocketReplySource;
  status: "SENT" | "DELIVERED" | "READ";
  createdAt: Date;
}): SocketMessage {
  return {
    id: message.id,
    conversationId: message.conversationId,
    senderId: message.senderId,
    type: message.type,
    text: message.text,
    imageKey: message.imageKey,
    replyTo: toSocketReplyMessage(message.replyToMessage),
    status: message.status,
    createdAt: message.createdAt.toISOString(),
  };
}

function emitStatusUpdate(
  io: SocketServer,
  payload: ChatMessageStatusUpdatedEvent,
  participantIds: string[],
) {
  for (const participantId of participantIds) {
    io.to(userRoom(participantId)).emit("chat:message_status_updated", payload);
  }
}

async function handleSendMessage(
  io: SocketServer,
  socket: AuthenticatedSocket,
  payload: SendMessagePayload,
  ack: (response: SocketAckResponse<{
    message: SocketMessage;
    sender: SocketPublicUser;
    clientMessageId: string | null;
  }>) => void,
) {
  const sender = socket.data.user;
  const conversationId = payload.conversationId?.trim();
  const messageType = parseIncomingMessageType(payload.type);
  const replyToMessageId = payload.replyToMessageId?.trim() || null;
  const clientMessageId = payload.clientMessageId?.trim() || null;

  if (!conversationId || !messageType) {
    return ackError(ack, "INVALID_PAYLOAD", "conversationId and valid type are required.");
  }

  if (replyToMessageId && !isUuid(replyToMessageId)) {
    return ackError(ack, "INVALID_PAYLOAD", "replyToMessageId must be a valid UUID.");
  }

  const conversation = await getConversationForMember(conversationId, sender.id);
  if (!conversation) {
    return ackError(
      ack,
      "FORBIDDEN",
      "You are not allowed to send messages in this conversation.",
    );
  }

  let text: string | null = null;
  let imageKey: string | null = null;

  if (messageType === "TEXT") {
    text = payload.text?.trim() ?? "";
    if (!text) {
      return ackError(ack, "INVALID_TEXT", "Text message requires non-empty text.");
    }

    if (text.length > MESSAGE_TEXT_LIMIT) {
      return ackError(
        ack,
        "TEXT_TOO_LONG",
        `Text length must be at most ${MESSAGE_TEXT_LIMIT} characters.`,
      );
    }
  } else {
    imageKey = payload.imageKey?.trim() || payload.imageUrl?.trim() || null;
    if (!imageKey) {
      return ackError(ack, "INVALID_IMAGE", "Image message requires imageKey or imageUrl.");
    }
  }

  if (replyToMessageId) {
    const replyTarget = await prisma.message.findFirst({
      where: {
        id: replyToMessageId,
        conversationId,
      },
      select: {
        id: true,
      },
    });

    if (!replyTarget) {
      return ackError(
        ack,
        "INVALID_REPLY_TARGET",
        "replyToMessageId must reference a message in the same conversation.",
      );
    }
  }

  const now = new Date();
  const message = await prisma.message.create({
    data: {
      conversationId,
      senderId: sender.id,
      replyToMessageId,
      type: messageType,
      text,
      imageKey,
      status: "SENT",
    },
    select: {
      id: true,
      conversationId: true,
      senderId: true,
      type: true,
      text: true,
      imageKey: true,
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
      status: true,
      createdAt: true,
    },
  });

  await prisma.userConversation.upsert({
    where: {
      conversationId_userId: {
        conversationId,
        userId: sender.id,
      },
    },
    update: {
      lastReadAt: now,
    },
    create: {
      conversationId,
      userId: sender.id,
      lastReadAt: now,
    },
  });

  const receiverId = conversation.userAId === sender.id ? conversation.userBId : conversation.userAId;
  const socketMessage = toSocketMessage(message);
  const eventPayload: ChatNewMessageEvent = {
    message: socketMessage,
    sender,
    clientMessageId,
  };

  io.to(userRoom(receiverId)).emit("chat:new_message", eventPayload);
  registerPendingDeliveryAck(message.id);

  ackSuccess(ack, {
    message: socketMessage,
    sender,
    clientMessageId,
  });
}

async function handleMessageDelivered(
  io: SocketServer,
  socket: AuthenticatedSocket,
  payload: MessageDeliveredPayload,
  ack?: (response: SocketAckResponse) => void,
) {
  const messageId = payload.messageId?.trim();
  if (!messageId) {
    return ackError(ack, "INVALID_PAYLOAD", "messageId is required.");
  }

  const message = await prisma.message.findUnique({
    where: { id: messageId },
    select: {
      id: true,
      senderId: true,
      status: true,
      conversationId: true,
      conversation: {
        select: {
          userAId: true,
          userBId: true,
        },
      },
    },
  });

  if (!message) {
    return ackError(ack, "NOT_FOUND", "Message not found.");
  }

  const receiverId = socket.data.user.id;
  const participantIds = [message.conversation.userAId, message.conversation.userBId];
  if (!participantIds.includes(receiverId)) {
    return ackError(ack, "FORBIDDEN", "Not a member of this conversation.");
  }

  if (receiverId === message.senderId) {
    return ackSuccess(ack);
  }

  if (message.status === "SENT") {
    await prisma.message.update({
      where: { id: message.id },
      data: { status: "DELIVERED" },
    });

    emitStatusUpdate(
      io,
      {
        conversationId: message.conversationId,
        messageId: message.id,
        status: "DELIVERED",
      },
      participantIds,
    );
  }

  clearPendingDeliveryAck(message.id);
  ackSuccess(ack);
}

async function handleMessageRead(
  io: SocketServer,
  socket: AuthenticatedSocket,
  payload: MessageReadPayload,
  ack?: (response: SocketAckResponse<{ updatedCount: number }>) => void,
) {
  const userId = socket.data.user.id;
  const conversationId = payload.conversationId?.trim();

  if (!conversationId) {
    return ackError(ack, "INVALID_PAYLOAD", "conversationId is required.");
  }

  const conversation = await getConversationForMember(conversationId, userId);
  if (!conversation) {
    return ackError(ack, "FORBIDDEN", "Not a member of this conversation.");
  }

  const resolved = await resolveReadTimestamp({
    ...payload,
    conversationId,
  });

  if (!resolved.valid) {
    return ackError(ack, "INVALID_PAYLOAD", "Invalid lastReadMessageId or timestamp.");
  }

  const { participantIds, unreadIds } = await applyConversationReadState({
    conversation,
    userId,
    readAt: resolved.timestamp,
  });

  if (unreadIds.length > 0) {
    for (const messageId of unreadIds) {
      clearPendingDeliveryAck(messageId);
      emitStatusUpdate(
        io,
        {
          conversationId,
          messageId,
          status: "READ",
        },
        participantIds,
      );
    }
  }

  ackSuccess(ack, { updatedCount: unreadIds.length });
}

export function registerSocketHandlers(io: SocketServer) {
  io.use(async (socket, next) => {
    try {
      const cookieHeader = socket.handshake.headers.cookie ?? "";
      const cookies = parseCookie(cookieHeader);
      const token = cookies[AUTH_COOKIE_NAME];

      if (!token) {
        return next(new Error("UNAUTHORIZED"));
      }

      const session = verifySessionToken(token);
      if (!session) {
        return next(new Error("UNAUTHORIZED"));
      }

      const user = await prisma.user.findUnique({
        where: { id: session.sub },
        select: {
          id: true,
          username: true,
          email: true,
          createdAt: true,
        },
      });

      if (!user) {
        return next(new Error("UNAUTHORIZED"));
      }

      socket.data.user = {
        id: user.id,
        username: user.username,
        email: user.email,
        createdAt: user.createdAt.toISOString(),
      };

      return next();
    } catch {
      return next(new Error("UNAUTHORIZED"));
    }
  });

  io.on("connection", (socket) => {
    const currentUser = socket.data.user;
    socket.join(userRoom(currentUser.id));

    socket.on("chat:send_message", async (payload, ack) => {
      try {
        await handleSendMessage(io, socket, payload, ack);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to send message.";
        ackError(ack, "SEND_FAILED", message);
      }
    });

    socket.on("chat:message_delivered", async (payload, ack) => {
      try {
        await handleMessageDelivered(io, socket, payload, ack);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to mark message as delivered.";
        ackError(ack, "DELIVERY_UPDATE_FAILED", message);
      }
    });

    socket.on("chat:message_read", async (payload, ack) => {
      try {
        await handleMessageRead(io, socket, payload, ack);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to update read status.";
        ackError(ack, "READ_UPDATE_FAILED", message);
      }
    });
  });
}

declare global {
  var __socketIoServer: SocketServer | undefined;
}

export function getOrCreateSocketServer(server: HttpServer): SocketServer {
  if (globalThis.__socketIoServer) {
    return globalThis.__socketIoServer;
  }

  const io = new SocketIOServer<ClientToServerEvents, ServerToClientEvents, object, SocketData>(
    server,
    {
      path: "/api/socket/io",
      serveClient: false,
      transports: ["websocket", "polling"],
    },
  );

  registerSocketHandlers(io);
  globalThis.__socketIoServer = io;
  return io;
}
