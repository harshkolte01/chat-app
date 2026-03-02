# 2026-03-02 23:56 - Phase E Socket.IO Realtime Layer

## What was implemented

- Added Socket.IO realtime infrastructure with auth based on the same cookie session used by REST auth.
- Added a dedicated Socket.IO bootstrap endpoint:
  - `pages/api/socket.ts`
- Added shared Socket contracts/types:
  - `lib/socket/contracts.ts`
- Added server-side Socket.IO handler logic:
  - `lib/socket/server.ts`

## Handshake authentication

- During socket handshake, server reads cookie header and validates `AUTH_COOKIE_NAME` token.
- Reuses existing JWT verification logic from `lib/auth/jwt.ts`.
- Loads user from DB and stores user data in `socket.data.user`.
- Rejects unauthorized connections with `UNAUTHORIZED`.

## Room join behavior

- On connection, each socket joins:
  - `user:<userId>`
- This room is used for direct receiver-targeted realtime emits.

## Implemented socket events

### Client -> Server

- `chat:send_message`
  - Validates authenticated session.
  - Validates payload and message type (`text/image` or `TEXT/IMAGE`).
  - Validates conversation membership.
  - Persists message in DB with status `SENT`.
  - Emits `chat:new_message` to receiver room (`user:<receiverId>`).
  - Returns ack to sender with stored message, sender info, and `clientMessageId`.

- `chat:message_delivered`
  - Receiver acknowledges message receipt.
  - Validates membership and sender/receiver constraints.
  - Updates message status from `SENT` -> `DELIVERED`.
  - Emits `chat:message_status_updated` to conversation participants.

- `chat:message_read`
  - Supports `conversationId + lastReadMessageId` or `conversationId + timestamp`.
  - Updates `UserConversation.lastReadAt`.
  - Marks eligible messages as `READ`.
  - Emits `chat:message_status_updated` for updated messages.

### Server -> Client

- `chat:new_message`
  - Payload includes full message object + sender info + echoed `clientMessageId`.

- `chat:message_status_updated`
  - Payload includes `conversationId`, `messageId`, `status`.

## Online guarantee handling

- Added in-memory pending delivery tracker with timeout (`SOCKET_DELIVERY_ACK_TIMEOUT_MS`, default `10000`ms).
- After emitting `chat:new_message`, message is tracked as awaiting delivery ack.
- If receiver acks with `chat:message_delivered`, status transitions to `DELIVERED`.
- If no ack arrives, status remains `SENT` (no forced transition), and message remains fetchable via REST on reconnect.

## Chat client integration

- Updated `app/chat/chat-client.tsx` to integrate Socket.IO while preserving REST fallback.
- Client behavior now:
  - Initializes `/api/socket`, then connects via Socket.IO path `/api/socket/io`.
  - Sends messages over `chat:send_message` with optimistic UI and `clientMessageId`.
  - Falls back to REST `POST /api/messages/send` when socket unavailable/ack fails.
  - Receives realtime `chat:new_message` and appends to active conversation instantly.
  - Sends `chat:message_delivered` on receiving messages.
  - Sends `chat:message_read` for active conversation head message.
  - Applies `chat:message_status_updated` to message/conversation UI.

## Dependency updates

- Added runtime dependencies:
  - `socket.io`
  - `socket.io-client`
- Added script:
  - `npm run test:socket` -> runs `scripts/socket-realtime-check.mjs`

## Testing implemented and executed

- Added socket realtime E2E test script:
  - `scripts/socket-realtime-check.mjs`
- Test covers:
  - Authenticated socket connect for both users.
  - `chat:send_message` ack flow.
  - Receiver `chat:new_message` receipt.
  - Receiver `chat:message_delivered` -> sender gets `DELIVERED`.
  - Receiver `chat:message_read` -> sender gets `READ`.
  - No-delivery-ack scenario keeps message status `SENT`.

## Validation run summary

- `npm run lint` -> pass
- `npx tsc --noEmit` -> pass
- Existing REST E2E script run -> pass
  - `scripts/api-endpoints-check.mjs`
- New Socket.IO E2E script run -> pass
  - `scripts/socket-realtime-check.mjs`

## Notes

- Server log contains a PostgreSQL SSL warning from `pg` regarding future `sslmode` behavior; functionality is unaffected in current run.
