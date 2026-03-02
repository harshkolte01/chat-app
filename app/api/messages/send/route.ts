import { NextRequest } from "next/server";
import { fail, ok, parseJsonBody } from "@/lib/api/responses";
import { getCurrentUserFromRequest, serializePublicUser } from "@/lib/auth/current-user";
import { isConversationMember } from "@/lib/chat/membership";
import { prisma } from "@/lib/db";

type SendMessageBody = {
  conversationId?: string;
  text?: string;
  imageUrl?: string;
  imageKey?: string;
};

const MAX_TEXT_LENGTH = 4000;
const MAX_IMAGE_REF_LENGTH = 4000;

export async function POST(request: NextRequest) {
  const currentUser = await getCurrentUserFromRequest(request);
  if (!currentUser) {
    return fail(401, "UNAUTHORIZED", "Authentication required.");
  }

  const body = await parseJsonBody<SendMessageBody>(request);
  if (!body) {
    return fail(400, "INVALID_JSON", "Request body must be valid JSON.");
  }

  const conversationId = body.conversationId?.trim();
  const text = body.text?.trim() ?? "";
  const imageRef = body.imageUrl?.trim() || body.imageKey?.trim() || "";

  if (!conversationId) {
    return fail(400, "MISSING_FIELDS", "conversationId is required.");
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

  const now = new Date();
  const message = await prisma.message.create({
    data: {
      conversationId,
      senderId: currentUser.id,
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
        ...message,
        createdAt: message.createdAt.toISOString(),
      },
      sender: serializePublicUser(currentUser),
    },
    201,
  );
}
