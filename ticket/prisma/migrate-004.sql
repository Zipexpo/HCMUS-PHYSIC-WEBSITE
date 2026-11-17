-- Hệ ticket — đợt 4: chấm điểm hỗ trợ, cài đặt chung (thông báo sự cố, mốc
-- gửi thư tóm tắt). CHỈ CỘNG THÊM. Chạy lại được nhiều lần.
--
--   docker exec -i hcmus-cms-db-1 psql -U physics -d hcmus_ticket -v ON_ERROR_STOP=1 -f - < ticket/prisma/migrate-004.sql

BEGIN;

ALTER TABLE "Ticket" ADD COLUMN IF NOT EXISTS "rating" INTEGER;
ALTER TABLE "Ticket" ADD COLUMN IF NOT EXISTS "ratingNote" TEXT;
ALTER TABLE "Ticket" ADD COLUMN IF NOT EXISTS "ratedAt" TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS "TicketSetting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TicketSetting_pkey" PRIMARY KEY ("key")
);

GRANT SELECT, INSERT, UPDATE, DELETE ON "TicketSetting" TO ticket_app;

COMMIT;

SELECT 'ok' AS migrate_004;
