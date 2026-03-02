# 2026-03-02 23:06 - Phase C/D Auth and Chat REST Implementation

## Summary

Implemented Phase C (authentication) and Phase D (core chat REST APIs) end-to-end in the Next.js App Router project, including:
- Invite-code gated signup (`username + email + password + accessCode`)
- Email/password login
- Logout
- `GET /api/me`
- Conversation list/create APIs
- Message list (cursor pagination) and REST send fallback API
- Server-side chat route protection with redirect to `/login`
- Minimal login/signup/chat pages wired to the APIs for immediate verification

## API Endpoints Implemented

### Auth
- `POST /api/auth/signup`
  - Validates required fields
  - Validates `INVITE_CODE`
  - Validates username/email format
  - Validates password length
  - Enforces unique username/email
  - Hashes password with `scrypt`
  - Creates user
  - Sets `httpOnly` JWT cookie session
- `POST /api/auth/login`
  - Validates required fields
  - Finds user by normalized email
  - Verifies `scrypt` hash
  - Sets `httpOnly` JWT cookie session
- `POST /api/auth/logout`
  - Clears auth cookie
- `GET /api/me`
  - Returns authenticated user profile

### Chat REST
- `GET /api/conversations`
  - Returns current user's conversations
  - Includes other user details
  - Includes last message preview and timestamp
  - Sorted by latest activity
- `POST /api/conversations`
  - Accepts `otherUserId` or `username`
  - Returns existing conversation or creates canonical one
  - Enforces pair normalization (`userAId/userBId`)
  - Handles race on unique pair create
  - Upserts `UserConversation` rows for both users
- `GET /api/messages?conversationId=...&cursor=...`
  - Requires membership in conversation
  - Cursor pagination (newest-first)
  - Returns `nextCursor` for infinite scroll
- `POST /api/messages/send`
  - REST fallback send endpoint
  - Requires membership
  - Sends text messages (`TEXT`) and updates sender read pointer

## Security and Session Design

- Session strategy: JWT in `httpOnly` cookie (MVP, no session table)
- Cookie settings:
  - `httpOnly: true`
  - `sameSite: "lax"`
  - `secure` in production
  - 7-day TTL
- JWT:
  - HS256 signature using `AUTH_JWT_SECRET` (fallback to `INVITE_CODE` if secret absent)
  - Payload includes `sub`, `email`, `username`, `iat`, `exp`
  - Signature + expiry validated on every request
- Passwords:
  - `scrypt` + random salt
  - Timing-safe hash comparison

## Route Protection

- Added server-side guard helper: `lib/auth/guards.ts`
- Added `/chat` layout-level guard:
  - Reads cookie
  - Verifies JWT session
  - Loads current user
  - Redirects unauthenticated access to `/login`

## Files Added

- `lib/db.ts`
- `lib/api/responses.ts`
- `lib/auth/constants.ts`
- `lib/auth/password.ts`
- `lib/auth/jwt.ts`
- `lib/auth/session.ts`
- `lib/auth/current-user.ts`
- `lib/auth/guards.ts`
- `lib/chat/membership.ts`
- `app/api/auth/signup/route.ts`
- `app/api/auth/login/route.ts`
- `app/api/auth/logout/route.ts`
- `app/api/me/route.ts`
- `app/api/conversations/route.ts`
- `app/api/messages/route.ts`
- `app/api/messages/send/route.ts`
- `app/chat/layout.tsx`
- `app/chat/page.tsx`
- `app/chat/chat-client.tsx`
- `app/login/page.tsx`
- `app/login/login-form.tsx`
- `app/signup/page.tsx`
- `app/signup/signup-form.tsx`

## Files Updated

- `prisma/schema.prisma`
  - Switched generator to `prisma-client-js` for standard `@prisma/client` integration
- `app/page.tsx`
  - Redirects to `/chat` if authenticated, else `/login`
- `app/layout.tsx`
  - Removed external Google font fetches to avoid network dependency during build

## Validation Performed

- `npm run lint` -> passes
- `npx tsc --noEmit` -> passes
- `npx prisma generate` -> failed in this environment because Prisma CLI could not download `schema-engine` (network restriction). Run it once in a network-enabled environment before starting the app.
- `npm run build` -> compile step succeeds, but environment throws `spawn EPERM` during Next build typecheck phase (sandbox/runtime restriction), so full production build completion was not possible in this environment.
