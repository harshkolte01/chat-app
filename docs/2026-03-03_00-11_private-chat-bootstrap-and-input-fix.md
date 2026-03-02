# Private Chat Bootstrap and Input Enablement Fix

## Context
- Investigated why message input felt unusable: composer is intentionally disabled until a conversation is selected.
- Identified missing frontend flow to create/select a private conversation from the UI.

## What Implemented
- Added `GET /api/users` endpoint to fetch available users (excluding current user), with optional `query` filter by username/email.
- Updated chat sidebar with a new `Start private chat` section:
  - search input for username/email,
  - user selector dropdown,
  - `Start chat` button that calls `POST /api/conversations` and auto-selects the returned conversation.
- Updated empty-state copy for conversations to guide users to start a chat from the UI.
- Updated composer placeholder to clearly explain when a conversation must be selected first.

## Privacy Clarification
- Conversations are pair-based (`userAId`, `userBId`) and message access is guarded by membership checks.
- Only conversation participants can load/send messages for that conversation.

## Verification
- Ran `npm run lint` successfully.
