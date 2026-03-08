-- Create enums for persisted call sessions.
CREATE TYPE "CallMode" AS ENUM ('AUDIO', 'VIDEO');
CREATE TYPE "CallStatus" AS ENUM (
  'RINGING',
  'ACTIVE',
  'REJECTED',
  'MISSED',
  'CANCELED',
  'ENDED',
  'FAILED'
);

CREATE TABLE "CallSession" (
  "id" UUID NOT NULL,
  "conversationId" UUID NOT NULL,
  "callerId" UUID NOT NULL,
  "calleeId" UUID NOT NULL,
  "mode" "CallMode" NOT NULL,
  "status" "CallStatus" NOT NULL DEFAULT 'RINGING',
  "failureReason" TEXT,
  "answeredAt" TIMESTAMP(3),
  "endedAt" TIMESTAMP(3),
  "endedById" UUID,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CallSession_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CallSession_conversationId_createdAt_idx"
  ON "CallSession"("conversationId", "createdAt");

CREATE INDEX "CallSession_conversationId_status_createdAt_idx"
  ON "CallSession"("conversationId", "status", "createdAt");

CREATE INDEX "CallSession_callerId_status_idx"
  ON "CallSession"("callerId", "status");

CREATE INDEX "CallSession_calleeId_status_idx"
  ON "CallSession"("calleeId", "status");

CREATE INDEX "CallSession_status_createdAt_idx"
  ON "CallSession"("status", "createdAt");

ALTER TABLE "CallSession"
  ADD CONSTRAINT "CallSession_conversationId_fkey"
  FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CallSession"
  ADD CONSTRAINT "CallSession_callerId_fkey"
  FOREIGN KEY ("callerId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CallSession"
  ADD CONSTRAINT "CallSession_calleeId_fkey"
  FOREIGN KEY ("calleeId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CallSession"
  ADD CONSTRAINT "CallSession_endedById_fkey"
  FOREIGN KEY ("endedById") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
