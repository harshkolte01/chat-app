import { NextRequest } from "next/server";
import { fail, ok, parseJsonBody } from "@/lib/api/responses";
import { getCurrentUserFromRequest, serializePublicUser } from "@/lib/auth/current-user";
import { isConversationMember } from "@/lib/chat/membership";
import { prisma } from "@/lib/db";

type SendMessageBody = {
  conversationId?: string;
  text?: string;
};

const MAX_TEXT_LENGTH = 4000;

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

  if (!conversationId || !text) {
    return fail(400, "MISSING_FIELDS", "conversationId and text are required.");
  }

  if (text.length > MAX_TEXT_LENGTH) {
    return fail(
      400,
      "MESSAGE_TOO_LONG",
      `Message text must be at most ${MAX_TEXT_LENGTH} characters.`,
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
      type: "TEXT",
      text,
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
