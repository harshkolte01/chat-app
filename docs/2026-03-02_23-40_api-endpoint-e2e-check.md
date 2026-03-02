# 2026-03-02 23:40 - API Endpoint E2E Check Script

## What was implemented

- Added a single-file end-to-end API verification script:
  - `scripts/api-endpoints-check.mjs`
- Script behavior:
  - Validates server availability (`/api/me`)
  - Creates first account via `POST /api/auth/signup`
  - Validates `GET /api/me`
  - Tests logout/login (`POST /api/auth/logout`, `POST /api/auth/login`)
  - Creates second account via signup
  - Creates conversation (`POST /api/conversations`) and re-checks dedupe
  - Fetches conversations (`GET /api/conversations`) for both users
  - Sends messages (`POST /api/messages/send`) from both users
  - Fetches messages (`GET /api/messages`) and validates cursor pagination
  - Re-validates second user logout/login + `/api/me`
- Uses isolated cookie jars per user in the same script so session flows are properly tested.

## Runtime fixes required to pass checks

- Prisma was failing at runtime with:
  - `PrismaClientConstructorValidationError: Using engine type "client" requires either "adapter" or "accelerateUrl"...`
- Fix applied:
  - Installed dependencies:
    - `@prisma/adapter-pg`
    - `pg`
    - `@types/pg` (dev)
  - Updated `lib/db.ts` to use `PrismaPg` adapter with a pooled `pg` connection.
  - Updated Prisma generator in `prisma/schema.prisma` to:
    - `provider = "prisma-client-js"`
    - `engineType = "client"`
  - Regenerated Prisma Client.

## Validation executed

- Static checks:
  - `npm run lint` -> pass
  - `npx tsc --noEmit` -> pass
- End-to-end API run:
  - Server started on `http://127.0.0.1:3000`
  - All required endpoint calls returned expected status codes:
    - `GET /api/me` -> `401` (unauthenticated)
    - `POST /api/auth/signup` -> `201` (user 1)
    - `GET /api/me` -> `200` (user 1)
    - `POST /api/auth/logout` -> `200`
    - `GET /api/me` -> `401`
    - `POST /api/auth/login` -> `200`
    - `GET /api/me` -> `200`
    - `POST /api/auth/signup` -> `201` (user 2)
    - `POST /api/conversations` -> `201` (create)
    - `POST /api/conversations` -> `200` (existing dedupe)
    - `GET /api/conversations` -> `200` (both users)
    - `POST /api/messages/send` -> `201` (multiple sends)
    - `GET /api/messages?conversationId=...` -> `200`
    - `GET /api/messages?conversationId=...&cursor=...` -> `200`
    - `POST /api/auth/logout` -> `200` (user 2)
    - `GET /api/me` -> `401` (user 2 logged out)
    - `POST /api/auth/login` -> `200` (user 2)
    - `GET /api/me` -> `200` (user 2)

## Notes

- Script expects the server at `http://127.0.0.1:3000` by default.
- Override base URL with:
  - `API_BASE_URL=http://host:port`
- Auto-start mode is optional:
  - set `AUTO_START_SERVER=1` (if environment allows child process spawning).
