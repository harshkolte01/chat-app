import { NextRequest } from "next/server";
import { fail, ok, parseJsonBody } from "@/lib/api/responses";
import { serializePublicUser } from "@/lib/auth/current-user";
import { requirePinUnlockedApiUser } from "@/lib/auth/pin-access";
import { isConversationMember } from "@/lib/chat/membership";
import { prisma } from "@/lib/db";

type SendMessageBody = {
  conversationId?: string;
  text?: string;
  imageUrl?: string;
  imageKey?: string;
  replyToMessageId?: string;
};

const MAX_TEXT_LENGTH = 4000;
const MAX_IMAGE_REF_LENGTH = 4000;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

export async function POST(request: NextRequest) {
  const auth = await requirePinUnlockedApiUser(request);
  if (auth.response) {
    return auth.response;
  }
  const currentUser = auth.user;

  const body = await parseJsonBody<SendMessageBody>(request);
  if (!body) {
    return fail(400, "INVALID_JSON", "Request body must be valid JSON.");
  }

  const conversationId = body.conversationId?.trim();
  const text = body.text?.trim() ?? "";
  const imageRef = body.imageUrl?.trim() || body.imageKey?.trim() || "";
  const replyToMessageId = body.replyToMessageId?.trim() || null;

  if (!conversationId) {
    return fail(400, "MISSING_FIELDS", "conversationId is required.");
  }

  if (replyToMessageId && !isUuid(replyToMessageId)) {
    return fail(400, "INVALID_REPLY_TARGET", "replyToMessageId must be a valid UUID.");
  }

  const hasText = text.length > 0;
  const hasImage = imageRef.length > 0;
  if (hasText === hasImage) {
    return fail(
      400,
      "INVALID_MESSAGE_PAYLOAD",
      "Provide exactly one of text or imageUrl/imageKey.",
    );
  }

  if (hasText && text.length > MAX_TEXT_LENGTH) {
    return fail(
      400,
      "MESSAGE_TOO_LONG",
      `Message text must be at most ${MAX_TEXT_LENGTH} characters.`,
    );
  }

  if (hasImage && imageRef.length > MAX_IMAGE_REF_LENGTH) {
    return fail(
      400,
      "IMAGE_REF_TOO_LONG",
      `imageUrl/imageKey must be at most ${MAX_IMAGE_REF_LENGTH} characters.`,
    );
  }

  const canAccess = await isConversationMember(conversationId, currentUser.id);
  if (!canAccess) {
    return fail(403, "FORBIDDEN", "You do not have access to this conversation.");
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
      return fail(
        400,
        "INVALID_REPLY_TARGET",
        "replyToMessageId must reference a message in the same conversation.",
      );
    }
  }

  const now = new Date();
  const message = await prisma.message.create({
    data: {
      conversationId,
      senderId: currentUser.id,
      replyToMessageId,
      type: hasText ? "TEXT" : "IMAGE",
      text: hasText ? text : null,
      imageKey: hasImage ? imageRef : null,
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
        userId: currentUser.id,
      },
    },
    update: {
      lastReadAt: now,
    },
    create: {
      conversationId,
      userId: currentUser.id,
      lastReadAt: now,
    },
  });

  return ok(
    {
      message: {
        id: message.id,
        conversationId: message.conversationId,
        senderId: message.senderId,
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
      },
      sender: serializePublicUser(currentUser),
    },
    201,
  );
}
