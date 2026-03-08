# Desktop Calls Implementation

## Scope

Implemented a desktop-only calling stack for SecretChat with:

- 1:1 voice calls
- 1:1 video calls
- in-call screen sharing
- optional Windows system-audio sharing during screen share
- standalone Socket.IO signaling over the external realtime server
- persisted `CallSession` records for ringing, active, ended, rejected, missed, and canceled calls

## Architecture

- Media transport: WebRTC
- Signaling: standalone Socket.IO server on Render/VPS
- Desktop capture bridge: Electron main + preload
- Persistence: Prisma `CallSession`

The chat app still uses REST polling as a fallback for messages, but calls require the realtime server to be available.

## Files Added

- `lib/call-contracts.ts`
- `lib/call-config.ts`
- `lib/socket/call-server.ts`
- `components/chat/CallOverlay.tsx`
- `components/chat/useDesktopCallController.ts`
- `prisma/migrations/20260308153000_add_call_sessions/migration.sql`

## Files Updated

- `prisma/schema.prisma`
- `lib/socket/contracts.ts`
- `lib/socket/server.ts`
- `desktop-chat-app/main.cjs`
- `desktop-chat-app/preload.cjs`
- `lib/desktop-bridge.ts`
- `app/chat/chat-client.tsx`
- `.env`

## Production TODO

- Apply the new Prisma migration on the deployed database.
- Configure TURN credentials in `NEXT_PUBLIC_WEBRTC_ICE_SERVERS_JSON`.
- Set the same `CALL_RING_TIMEOUT_MS` on the realtime host if you want a non-default ringing timeout.
- Validate Electron screen/audio capture on the packaged Windows build, not only in local Electron dev.
- Add explicit missed-call and ended-call history to the conversation UI if call history needs to be user-visible.

## Env Reference

Vercel:

- `NEXT_PUBLIC_REALTIME_URL=https://YOUR-REALTIME-HOST`
- `NEXT_PUBLIC_REALTIME_SOCKET_PATH=/socket.io`
- `NEXT_PUBLIC_WEBRTC_ICE_SERVERS_JSON=[{"urls":["stun:stun.l.google.com:19302"]},{"urls":["turn:ENTER_TURN_HOST:3478?transport=udp","turn:ENTER_TURN_HOST:3478?transport=tcp"],"username":"ENTER_TURN_USERNAME","credential":"ENTER_TURN_PASSWORD"}]`

Render / VPS realtime server:

- `DATABASE_URL=...`
- `AUTH_JWT_SECRET=...`
- `REALTIME_CORS_ORIGIN=https://sec-chat-application.vercel.app`
- `REALTIME_SOCKET_PATH=/socket.io`
- `CALL_RING_TIMEOUT_MS=45000`

## Validation

Validated locally with:

- `cmd /c npx prisma generate`
- `cmd /c npx tsc --noEmit --incremental false`
- `cmd /c npm run lint`
- `cmd /c npm run realtime:build`
- `cmd /c npm run build`
