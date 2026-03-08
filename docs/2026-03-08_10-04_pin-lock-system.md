# PIN Lock System

## Context

- Added a 6-digit PIN system on top of the existing login session for both web and Electron desktop flows.
- PIN setup is required for users who do not already have one; a tab-scoped unlock is required before chats load for users who do.
- The unlock state is stored in `sessionStorage`, so closing the browser tab or desktop window forces PIN entry again while the login session can remain active.

## What Changed

- Extended the Prisma `User` model with `pinHash`, `pinVersion`, and `pinUpdatedAt`, plus a matching SQL migration.
- Added shared PIN helpers for format validation, hashed storage, signed unlock tokens, and request token extraction.
- Added `POST /api/auth/pin/setup` and `POST /api/auth/pin/verify`.
- Added a shared API guard so chat REST endpoints now require:
  - a valid login session cookie
  - a configured PIN
  - a valid PIN unlock token
- Updated the Socket.IO handshake to require the same PIN unlock token as the REST APIs.
- Added a `/chat` access gate UI that:
  - shows `Setup your PIN` for users without a PIN
  - shows `Enter your PIN` for users with a configured PIN but no unlock token
  - mounts the full chat client only after successful PIN setup or unlock
- Updated image proxy requests to carry the PIN unlock token through query params so protected chat images still load after unlock.
- Cleared the PIN unlock token on logout.

## Verification

- Ran `npx prisma generate`
- Ran `npx prisma migrate deploy`
- Ran `npm run lint`
- Ran `npm run build`
