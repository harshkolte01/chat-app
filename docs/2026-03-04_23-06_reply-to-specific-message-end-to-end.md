# Reply to Specific Message End-to-End (2026-03-04 23:06)

## Context
Implemented full "reply to specific message" support across database, REST APIs, socket contracts/server, and chat UI.

## Data Model
Updated Prisma `Message` model:
- Added `replyToMessageId` (optional UUID)
- Added self-relation:
  - `replyToMessage` (parent message)
  - `replies` (child messages)
- Added index on `replyToMessageId`

Migration added:
- `prisma/migrations/20260304173000_add_message_reply_to/migration.sql`

## API Changes
### `POST /api/messages/send`
- Request now accepts `replyToMessageId?`
- Validates UUID format and ensures target message exists in same conversation
- Persists `replyToMessageId`
- Response now includes `message.replyTo` preview object:
  - `id`, `senderId`, `senderUsername`, `type`, `text`, `imageKey`, `createdAt`

### `GET /api/messages`
- Includes `replyToMessage` relation in query
- Response message payload now includes `replyTo` preview object (same shape as above)

## Socket Changes
### Contracts (`lib/socket/contracts.ts`)
- Added `SocketReplyMessage` type
- Added `replyTo: SocketReplyMessage | null` to `SocketMessage`
- Added `replyToMessageId?` to `SendMessagePayload`

### Server (`lib/socket/server.ts`)
- Validates `replyToMessageId` and same-conversation ownership
- Persists `replyToMessageId` on create
- Emits/acks `SocketMessage` containing `replyTo` preview data

## Frontend Changes
### Chat client (`app/chat/chat-client.tsx`)
- Extended message model with `replyTo`
- Added reply state `replyingTo`
- Added "Reply" action on each message bubble
- Passes `replyToMessageId` through socket and REST fallback for text and image sends
- Clears reply state after successful send; restores on failed text send
- Clears reply state on conversation switch
- Renders quoted preview block inside replied messages

### Composer (`components/chat/Composer.tsx`)
- New props: `currentUserId`, `replyingTo`, `onCancelReply`
- Shows "Replying to ..." preview bar with cancel button
- Maintains existing emoji picker + shortcode UX

## Validation
- `npx prisma generate`: passed (with escalation)
- `npm run lint`: passed
- `npx tsc --noEmit`: passed

## Notes
- Presence/last-seen was intentionally not implemented in this step.
- Reply works for both text and image messages with conversation-safe validation.
