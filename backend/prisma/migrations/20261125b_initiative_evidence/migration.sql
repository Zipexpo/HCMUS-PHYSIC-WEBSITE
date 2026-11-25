-- Minh chứng sáng kiến (bản quét quyết định) — 25/11/2026. Chỉ thêm cột, chạy lại không hỏng.
ALTER TABLE "Initiative" ADD COLUMN IF NOT EXISTS "evidenceFile" TEXT;
ALTER TABLE "Initiative" ADD COLUMN IF NOT EXISTS "evidenceName" TEXT;
