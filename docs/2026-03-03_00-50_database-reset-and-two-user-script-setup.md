# Database Reset And Two-User Script Setup

## Context
- Implemented utility scripts so database cleanup and controlled two-user creation can be run on demand.
- Executed database reset successfully to clear existing chat/auth data.
- User creation execution is intentionally left to manual run by request.

## What Implemented
- Added `scripts/reset-db-data.mjs`:
  - Clears all rows from `Message`, `UserConversation`, `Conversation`, and `User` tables.
  - Uses app-compatible Prisma adapter setup.
- Added `scripts/create-two-users.mjs`:
  - Contains editable `USERS_TO_CREATE` array with two user objects (`username`, `email`, `password`).
  - Hashes passwords using the same scrypt format as app auth.
  - Creates or updates users by email/username.
- Updated `package.json` scripts:
  - `db:reset-data`
  - `db:create-two-users`

## Execution Notes
- `db:reset-data` was run successfully.
- `db:create-two-users` was not run after user declined execution in this step.
