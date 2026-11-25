-- Sáng kiến được công nhận + tác giả (Khoa yêu cầu 25/11/2026).
--
-- CỘNG THÊM, không đụng gì đang có: hai bảng, các chỉ mục, hai khoá ngoại.
-- Chạy lại nhiều lần không hỏng (IF NOT EXISTS / DO block).

CREATE TABLE IF NOT EXISTS "Initiative" (
  "id"           TEXT NOT NULL,
  "code"         TEXT NOT NULL,
  "title"        TEXT NOT NULL,
  "level"        TEXT NOT NULL DEFAULT 'CO_SO',
  "decisionNo"   TEXT NOT NULL,
  "decisionDate" DATE,
  "category"     TEXT,
  "note"         TEXT,
  "url"          TEXT,
  "reviewStatus" TEXT NOT NULL DEFAULT 'PENDING',
  "approvedSnapshot" JSONB,
  "reviewNote"   TEXT,
  "reviewedBy"   TEXT,
  "reviewedAt"   TIMESTAMP(3),
  "source"       TEXT NOT NULL DEFAULT 'manual',
  "createdBy"    TEXT,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL,
  "deletedAt"    TIMESTAMP(3),
  CONSTRAINT "Initiative_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Initiative_code_key" ON "Initiative"("code");
CREATE INDEX IF NOT EXISTS "Initiative_deletedAt_idx" ON "Initiative"("deletedAt");
CREATE INDEX IF NOT EXISTS "Initiative_decisionDate_idx" ON "Initiative"("decisionDate");
CREATE INDEX IF NOT EXISTS "Initiative_reviewStatus_idx" ON "Initiative"("reviewStatus");

CREATE TABLE IF NOT EXISTS "InitiativeAuthor" (
  "id"           TEXT NOT NULL,
  "initiativeId" TEXT NOT NULL,
  "position"     INTEGER NOT NULL DEFAULT 0,
  "userId"       TEXT,
  "externalName" TEXT,
  "externalOrg"  TEXT,
  "claimStatus"  "AuthorClaimStatus" NOT NULL DEFAULT 'PENDING',
  "invitedBy"    TEXT,
  "respondedAt"  TIMESTAMP(3),
  "showOnWeb"    BOOLEAN NOT NULL DEFAULT true,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL,
  CONSTRAINT "InitiativeAuthor_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "InitiativeAuthor_initiativeId_userId_key"
  ON "InitiativeAuthor"("initiativeId", "userId");
CREATE INDEX IF NOT EXISTS "InitiativeAuthor_userId_claimStatus_idx"
  ON "InitiativeAuthor"("userId", "claimStatus");
CREATE INDEX IF NOT EXISTS "InitiativeAuthor_initiativeId_idx"
  ON "InitiativeAuthor"("initiativeId");

DO $$ BEGIN
  ALTER TABLE "InitiativeAuthor"
    ADD CONSTRAINT "InitiativeAuthor_initiativeId_fkey"
    FOREIGN KEY ("initiativeId") REFERENCES "Initiative"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "InitiativeAuthor"
    ADD CONSTRAINT "InitiativeAuthor_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
