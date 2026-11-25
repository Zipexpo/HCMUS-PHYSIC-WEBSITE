-- Minh chứng sáng kiến DÙNG CHUNG theo quyết định (25/11/2026): một QĐ tải một lần,
-- mọi sáng kiến cùng số QĐ + năm dùng lại. Chỉ THÊM — chạy TRƯỚC khi deploy backend.
-- Hai cột cũ evidenceFile / evidenceName bỏ ở 20261125d, SAU khi đã chuyển dữ liệu.

CREATE TABLE IF NOT EXISTS "DecisionFile" (
  "id"           TEXT NOT NULL,
  "decisionKey"  TEXT NOT NULL,
  "decisionNo"   TEXT NOT NULL,
  "label"        TEXT,
  "originalName" TEXT NOT NULL,
  "storedName"   TEXT NOT NULL,
  "mimeType"     TEXT NOT NULL,
  "size"         INTEGER NOT NULL,
  "uploadedBy"   TEXT,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deletedAt"    TIMESTAMP(3),
  CONSTRAINT "DecisionFile_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "DecisionFile_decisionKey_idx" ON "DecisionFile"("decisionKey");

ALTER TABLE "Initiative" ADD COLUMN IF NOT EXISTS "evidenceFileId" TEXT;
ALTER TABLE "Initiative" ADD COLUMN IF NOT EXISTS "evidencePage" INTEGER;

DO $$ BEGIN
  ALTER TABLE "Initiative"
    ADD CONSTRAINT "Initiative_evidenceFileId_fkey"
    FOREIGN KEY ("evidenceFileId") REFERENCES "DecisionFile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
