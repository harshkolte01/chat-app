# 2026-03-02 — Environment Setup & Database Design

## Phase A — Environment / Config

- Created `.env` with all required variables:
  - `DATABASE_URL` — Neon PostgreSQL pooled connection string
  - `PUBLIC_BASE_URL` — base URL for the app server
  - `S3_ENDPOINT` — MinIO instance endpoint
  - `S3_REGION` — S3-compatible region
  - `S3_ACCESS_KEY` / `S3_SECRET_KEY` — MinIO credentials
  - `S3_BUCKET` — bucket name for file uploads
  - `INVITE_CODE` — shared secret for joining the app
- Replaced the default Prisma Postgres local URL that `prisma init` generated.
- Prisma v7 requires the DB URL in `prisma.config.ts` (not in `schema.prisma`); `prisma.config.ts` already reads `DATABASE_URL` via `import "dotenv/config"`.

---

## Phase B — Database Design (Prisma Schema)

**Files changed:**
- `prisma/schema.prisma`
- `prisma/migrations/20260302171338_init_users_conversations_messages/migration.sql`

### Enums

| Enum | Values |
|---|---|
| `MessageType` | `TEXT`, `IMAGE` |
| `MessageStatus` | `SENT`, `DELIVERED`, `READ` |

### Models

#### `User`
| Column | Type | Notes |
|---|---|---|
| `id` | `UUID` PK | `@default(uuid())` |
| `username` | `String` | `@unique` |
| `email` | `String` | `@unique` |
| `passwordHash` | `String` | |
| `createdAt` | `DateTime` | `@default(now())` |

#### `Conversation`
| Column | Type | Notes |
|---|---|---|
| `id` | `UUID` PK | |
| `userAId` | `UUID` FK → `User` | Lexicographically **smaller** UUID |
| `userBId` | `UUID` FK → `User` | Lexicographically **larger** UUID |
| `createdAt` | `DateTime` | `@default(now())` |

- `@@unique([userAId, userBId])` prevents duplicate rows per pair.
- **Normalisation rule (enforced at app layer):** before every insert, set `userAId = min(uuidX, uuidY)`, `userBId = max(uuidX, uuidY)`. This guarantees one canonical row per pair regardless of who initiates.

#### `Message`
| Column | Type | Notes |
|---|---|---|
| `id` | `UUID` PK | |
| `conversationId` | `UUID` FK → `Conversation` | `ON DELETE CASCADE` |
| `senderId` | `UUID` FK → `User` | |
| `type` | `MessageType` | default `TEXT` |
| `text` | `String?` | Populated when `type = TEXT` |
| `imageKey` | `String?` | S3/MinIO object key when `type = IMAGE` (not full URL) |
| `status` | `MessageStatus` | default `SENT` |
| `createdAt` | `DateTime` | `@default(now())` |

- `@@index([conversationId, createdAt])` — powers efficient paginated message history queries.
- `imageKey` stores only the object key so the S3 base URL can change without a migration.

#### `UserConversation` (read-receipt pointer)
| Column | Type | Notes |
|---|---|---|
| `conversationId` | `UUID` FK → `Conversation` | `ON DELETE CASCADE` |
| `userId` | `UUID` FK → `User` | |
| `lastReadAt` | `DateTime` | Updated on every read event |

- Composite PK `(conversationId, userId)`.
- Enables unread-count queries: `Message.createdAt > UserConversation.lastReadAt`.

### Generator config
```prisma
generator client {
  provider = "prisma-client"
  output   = "../app/generated/prisma"
}
```
Prisma Client is emitted to `app/generated/prisma` — importable from anywhere in the Next.js app.

### Migration applied
```
Datasource "db": PostgreSQL database "neondb", schema "public"

Applied: 20260302171338_init_users_conversations_messages
```
All tables, indexes, unique constraints, foreign keys, and cascade rules are live on Neon.
