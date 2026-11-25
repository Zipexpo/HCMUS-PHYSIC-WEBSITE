-- Bỏ minh chứng RIÊNG từng sáng kiến (thay bằng DecisionFile dùng chung theo QĐ).
-- Chạy SAU khi backend mới đã lên và dữ liệu đã chuyển sang DecisionFile.
ALTER TABLE "Initiative" DROP COLUMN IF EXISTS "evidenceFile";
ALTER TABLE "Initiative" DROP COLUMN IF EXISTS "evidenceName";
