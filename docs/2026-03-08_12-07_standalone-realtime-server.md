# 2026-03-08 12:07 - Standalone Realtime Server

## Context

- Vercel is used for the Next.js app, but Socket.IO cannot be hosted there as an in-app server for production websocket signaling.
- Requirement: move realtime chat signaling to a standalone Socket.IO service that can be hosted on Render or a VPS.

## What was implemented

### Shared realtime auth/config

- Added `lib/realtime/token.ts`
  - creates and verifies short-lived realtime JWTs
  - uses `REALTIME_AUTH_JWT_SECRET` with fallback to `AUTH_JWT_SECRET`
- Added `lib/realtime/contracts.ts`
  - shared token response type and token error codes
- Added `lib/realtime/config.ts`
  - shared realtime URL/path helpers for client and server

### Next.js app changes

- Added `app/api/realtime/token/route.ts`
  - requires authenticated + PIN-unlocked user
  - returns a signed realtime token for the standalone Socket.IO server
- Updated `app/chat/chat-client.tsx`
  - no longer bootstraps `/api/socket`
  - now fetches `/api/realtime/token`
  - connects directly to `NEXT_PUBLIC_REALTIME_URL`
  - refreshes socket auth token once if the realtime server reports token expiry/invalidity

### Socket server changes

- Refactored `lib/socket/server.ts`
  - removed cookie-based socket handshake auth
  - now validates `handshake.auth.realtimeToken`
  - keeps the existing chat events and delivery/read behavior
  - exposes `createSocketServer(...)` for external hosting

### Standalone service

- Added `realtime-server/src/index.ts`
  - standalone HTTP + Socket.IO process
  - `/healthz` endpoint
  - configurable host, port, path, and CORS origins
  - supports Render-provided `PORT`
  - graceful shutdown handling
- Added `realtime-server/tsconfig.json`
- Added npm scripts:
  - `npm run realtime:build`
  - `npm run realtime:start`
  - `npm run test:socket`

### Compatibility

- Kept `pages/api/socket.ts` as a deprecated `410` response so old references fail clearly instead of silently hanging.

## Deployment shape

- Next.js app stays on Vercel.
- Standalone realtime server is intended for Render or VPS deployment.
- Browser/Electron renderer connects to the standalone realtime service using `NEXT_PUBLIC_REALTIME_URL`.

## Required env summary

- Web app:
  - `NEXT_PUBLIC_REALTIME_URL`
  - `NEXT_PUBLIC_REALTIME_SOCKET_PATH` optional
- Realtime server:
  - `REALTIME_PORT`
  - `REALTIME_HOST`
  - `REALTIME_SOCKET_PATH`
  - `REALTIME_CORS_ORIGIN`
  - `REALTIME_AUTH_JWT_SECRET` optional
  - `REALTIME_TOKEN_TTL_SECONDS` optional
- Shared:
  - `DATABASE_URL`
  - `AUTH_JWT_SECRET`

## Notes

- The realtime server still uses the existing database-backed message and read-state logic.
- This change prepares the project for future WebRTC calling features, since the standalone realtime service can now handle signaling independently of Vercel.
