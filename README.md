# SecretChat

SecretChat is a private 1:1 chat application with:

- Next.js for the main web app
- Electron for the desktop shell
- PostgreSQL + Prisma for persistence
- Socket.IO as a standalone realtime service for chat events

## Architecture

- `Next.js app`: authentication, PIN unlock, conversations, messages, uploads
- `Standalone realtime server`: Socket.IO signaling and message delivery/read events
- `Electron desktop app`: wraps the hosted Next.js app for desktop-only features

The intended production deployment is:

- `Vercel` for the Next.js frontend and HTTP APIs
- `Render` or a `VPS` for the standalone realtime server

## Local Development

Start the Next.js app:

```bash
npm run dev
```

Build the standalone realtime server:

```bash
npm run realtime:build
```

Start the standalone realtime server:

```bash
npm run realtime:start
```

## Required Environment Variables

### Shared

- `DATABASE_URL`
- `AUTH_JWT_SECRET`
- `INVITE_CODE`

### Web App

- `PUBLIC_BASE_URL`
- `NEXT_PUBLIC_REALTIME_URL`
- `NEXT_PUBLIC_REALTIME_SOCKET_PATH` optional, defaults to `/socket.io`
- `NEXT_APP_URL` for the Electron wrapper target URL

### Standalone Realtime Server

- `REALTIME_PORT` optional, defaults to `3001`
- `PORT` supported automatically for Render
- `REALTIME_HOST` optional, defaults to `0.0.0.0`
- `REALTIME_SOCKET_PATH` optional, defaults to `/socket.io`
- `REALTIME_CORS_ORIGIN` optional comma-separated origin list
- `REALTIME_AUTH_JWT_SECRET` optional, falls back to `AUTH_JWT_SECRET`
- `REALTIME_TOKEN_TTL_SECONDS` optional, defaults to `3600`

If `REALTIME_CORS_ORIGIN` is not set, the realtime server falls back to `PUBLIC_BASE_URL`, `NEXT_APP_URL`, and local development origins.

## Render Deployment

Only the standalone realtime service should be deployed on Render.

- Keep the Next.js app on Vercel.
- Create a Render Web Service from this repo.
- Set the service root directory to `chat-app`.
- Use `npm ci && npm run realtime:build` as the build command.
- Use `npm run realtime:start` as the start command.
- Set health check path to `/healthz`.

If you use Render Blueprints, the repo root [render.yaml](c:/Coding/sec-chat/render.yaml) already defines the realtime service only.

## Realtime Auth Flow

1. User signs in to the Next.js app.
2. User unlocks chat with PIN.
3. Client requests `POST /api/realtime/token`.
4. Next.js returns a signed short-lived realtime token.
5. Client connects directly to the standalone Socket.IO server using that token.

This avoids cookie-sharing problems between Vercel and Render/VPS.
