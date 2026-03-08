import { NextRequest } from "next/server";
import { fail, ok, parseJsonBody } from "@/lib/api/responses";
import { requirePinUnlockedApiUser } from "@/lib/auth/pin-access";
import {
  applyConversationReadState,
  getConversationForMember,
  resolveReadTimestamp,
} from "@/lib/chat/read-state";
import type { MessageReadPayload } from "@/lib/socket/contracts";

export async function POST(request: NextRequest) {
  const auth = await requirePinUnlockedApiUser(request);
  if (auth.response) {
    return auth.response;
  }
  const currentUser = auth.user;

  const body = await parseJsonBody<MessageReadPayload>(request);
  if (!body) {
    return fail(400, "INVALID_JSON", "Request body must be valid JSON.");
  }

  const conversationId = body.conversationId?.trim();
  if (!conversationId) {
    return fail(400, "MISSING_FIELDS", "conversationId is required.");
  }

  const conversation = await getConversationForMember(conversationId, currentUser.id);
  if (!conversation) {
    return fail(403, "FORBIDDEN", "You do not have access to this conversation.");
  }

  const resolved = await resolveReadTimestamp({
    ...body,
    conversationId,
  });
  if (!resolved.valid) {
    return fail(400, "INVALID_PAYLOAD", "Invalid lastReadMessageId or timestamp.");
  }

  const { unreadIds } = await applyConversationReadState({
    conversation,
    userId: currentUser.id,
    readAt: resolved.timestamp,
  });

  return ok({
    updatedCount: unreadIds.length,
    readAt: resolved.timestamp.toISOString(),
  });
}
