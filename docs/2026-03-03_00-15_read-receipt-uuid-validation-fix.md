# Read Receipt UUID Validation Fix

## Context
- Investigated Prisma error from `resolveReadTimestamp` during `chat:message_read`.
- Root cause: client can temporarily emit optimistic message IDs (`client-...`) before server UUID replaces them.
- Prisma `message.findUnique` expects UUID and throws when non-UUID IDs are sent.

## What Implemented
- Client-side fix (`app/chat/chat-client.tsx`):
  - Added UUID validation helper.
  - `chat:message_read` now sends:
    - `lastReadMessageId` only when message id is a real UUID.
    - `timestamp` fallback when latest message is optimistic (`client-*`).
- Server-side hardening (`lib/socket/server.ts`):
  - Added UUID validation before querying Prisma in `resolveReadTimestamp`.
  - Non-UUID `lastReadMessageId` is rejected as invalid payload without running Prisma query.

## Impact
- Removes noisy Prisma UUID syntax errors.
- Preserves chat behavior and read-status flow.
- Prevents malformed IDs from reaching database lookups.

## Verification
- Ran `npm run lint` successfully.
