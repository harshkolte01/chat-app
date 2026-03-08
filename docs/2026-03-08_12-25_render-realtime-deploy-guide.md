# 2026-03-08 12:25 - Render Realtime Deploy Guide

## Context

- Requirement: keep the main Next.js app on Vercel.
- Requirement: host only the standalone Socket.IO realtime server on Render.

## What was added

- Updated `.env` with the new realtime variables and reference comments.
- Added repo-root `render.yaml` that defines only one Render web service:
  - `sec-chat-realtime`
- Updated realtime server to support `PORT`, which Render injects automatically.

## Important deployment rule

- Render service root directory must be `chat-app`.
- Do **not** set the Render root directory to `chat-app/realtime-server`.
- Reason: the realtime service imports shared code from:
  - `lib/socket/server.ts`
  - `lib/chat/read-state.ts`
  - `lib/db.ts`

## Render setup

### Option A: Use the included Blueprint

- Push the repo.
- In Render, create a new Blueprint from the repository.
- Render will read `render.yaml` and create only the realtime service.

### Option B: Create a Web Service manually

- Runtime: `Node`
- Root Directory: `chat-app`
- Build Command: `npm ci && npm run realtime:build`
- Start Command: `npm run realtime:start`
- Health Check Path: `/healthz`

## Required Render environment variables

- `DATABASE_URL`
- `AUTH_JWT_SECRET`
- `REALTIME_CORS_ORIGIN`

## Optional Render environment variables

- `REALTIME_AUTH_JWT_SECRET`
- `REALTIME_TOKEN_TTL_SECONDS`
- `REALTIME_SOCKET_PATH`

## What to put in `REALTIME_CORS_ORIGIN`

Use the origin of your Vercel app, for example:

- `https://sec-chat-application.vercel.app`
- `https://your-custom-domain.com`

If you support both, provide a comma-separated list.

## What to put in Vercel

Set:

- `NEXT_PUBLIC_REALTIME_URL=https://your-render-service.onrender.com`
- `NEXT_PUBLIC_REALTIME_SOCKET_PATH=/socket.io`

## Result

- Vercel serves the Next.js app and REST APIs.
- Render serves only the standalone realtime Socket.IO process.
- The browser/Electron app connects from Vercel frontend to the Render realtime host using short-lived realtime tokens.
