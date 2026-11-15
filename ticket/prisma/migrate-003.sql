-- Hệ ticket — đợt 3: phân quyền theo nhóm, đầu mối đơn vị, duyệt cấp quyền,
-- thời hạn & leo thang.
--
-- CHỈ CỘNG THÊM cột/bảng. Thay đổi dữ liệu duy nhất: đổi tên 2 nhóm cho khớp
-- cơ cấu mới ("Quản trị hệ thống" → "Tài khoản & Quyền", "Biên tập web" →
-- "Biên tập nội dung"). Chạy lại được nhiều lần.
--
--   docker exec -i hcmus-cms-db-1 psql -U physics -d hcmus_ticket -v ON_ERROR_STOP=1 -f - < ticket/prisma/migrate-003.sql

BEGIN;

-- ── Cột mới ─────────────────────────────────────────────────────────────────
ALTER TABLE "TicketForm" ADD COLUMN IF NOT EXISTS "unitRoute" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "TicketForm" ADD COLUMN IF NOT EXISTS "approval" JSONB;

ALTER TABLE "Ticket" ADD COLUMN IF NOT EXISTS "reporterUnitId" TEXT;
ALTER TABLE "Ticket" ADD COLUMN IF NOT EXISTS "unitRoute" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Ticket" ADD COLUMN IF NOT EXISTS "approvalStatus" TEXT;
ALTER TABLE "Ticket" ADD COLUMN IF NOT EXISTS "approvalUnitId" TEXT;
ALTER TABLE "Ticket" ADD COLUMN IF NOT EXISTS "approvalUnitName" TEXT;
ALTER TABLE "Ticket" ADD COLUMN IF NOT EXISTS "approvedByName" TEXT;
ALTER TABLE "Ticket" ADD COLUMN IF NOT EXISTS "approvedAt" TIMESTAMP(3);
ALTER TABLE "Ticket" ADD COLUMN IF NOT EXISTS "approvalNote" TEXT;
ALTER TABLE "Ticket" ADD COLUMN IF NOT EXISTS "firstResponseAt" TIMESTAMP(3);
ALTER TABLE "Ticket" ADD COLUMN IF NOT EXISTS "escalation" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Ticket" ADD COLUMN IF NOT EXISTS "boardEscalated" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "TicketStaff" ADD COLUMN IF NOT EXISTS "unitId" TEXT;
ALTER TABLE "TicketStaff" ADD COLUMN IF NOT EXISTS "cmsRole" TEXT;

-- ── Bảng mới ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "TicketTeam" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TicketTeam_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "TicketTeam_name_key" ON "TicketTeam"("name");

CREATE TABLE IF NOT EXISTS "TicketTeamMember" (
    "teamId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'MEMBER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TicketTeamMember_pkey" PRIMARY KEY ("teamId", "email")
);
CREATE INDEX IF NOT EXISTS "TicketTeamMember_email_idx" ON "TicketTeamMember"("email");
DO $$ BEGIN
  ALTER TABLE "TicketTeamMember" ADD CONSTRAINT "TicketTeamMember_teamId_fkey"
    FOREIGN KEY ("teamId") REFERENCES "TicketTeam"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "TicketRole" (
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TicketRole_pkey" PRIMARY KEY ("email")
);

-- ── Ba nhóm ban đầu (đổi tên 2 nhóm cũ cho khớp cơ cấu mới) ──────────────────
UPDATE "TicketForm" SET "defaultTeam" = 'Tài khoản & Quyền' WHERE "defaultTeam" = 'Quản trị hệ thống';
UPDATE "Ticket"     SET "team"        = 'Tài khoản & Quyền' WHERE "team"        = 'Quản trị hệ thống';
UPDATE "TicketForm" SET "defaultTeam" = 'Biên tập nội dung' WHERE "defaultTeam" = 'Biên tập web';
UPDATE "Ticket"     SET "team"        = 'Biên tập nội dung' WHERE "team"        = 'Biên tập web';

INSERT INTO "TicketTeam" ("id", "name", "description", "sortOrder") VALUES
  ('team_ky_thuat_web', 'Kỹ thuật web', 'Web Khoa, trang quản trị, Hồ sơ khoa học, Chatbot', 10),
  ('team_tai_khoan',    'Tài khoản & Quyền', 'Cấp, khoá, phân quyền tài khoản; email', 20),
  ('team_bien_tap',     'Biên tập nội dung', 'Nội dung trên web Khoa', 30)
ON CONFLICT ("name") DO NOTHING;

-- ── Luật của mẫu biểu (chỉ đặt khi còn trống) ────────────────────────────────
-- Xin cấp tài khoản / xin thêm quyền → đầu mối đơn vị của người gửi duyệt trước.
UPDATE "TicketForm"
  SET "approval" = '{"field":"loai_yeu_cau","values":["Xin cấp tài khoản mới","Xin thêm quyền"]}'::jsonb
  WHERE key = 'tai-khoan' AND "approval" IS NULL;
-- Sửa nội dung → tới đầu mối web của đơn vị người gửi trước.
UPDATE "TicketForm" SET "unitRoute" = true WHERE key = 'sua-noi-dung';

-- ── Điền mốc phản hồi đầu cho phiếu cũ ──────────────────────────────────────
UPDATE "Ticket" t SET "firstResponseAt" = x.first
FROM (
  SELECT t2.id, LEAST(
    (SELECT min(c."createdAt") FROM "TicketComment" c
      WHERE c."ticketId" = t2.id AND NOT c."isInternal" AND c."authorUserId" <> t2."reporterUserId"),
    (SELECT min(e."createdAt") FROM "TicketEvent" e
      WHERE e."ticketId" = t2.id AND e.kind IN ('status', 'assign')
        AND e."actorUserId" IS DISTINCT FROM t2."reporterUserId")) AS first
  FROM "Ticket" t2
) x
WHERE t.id = x.id AND t."firstResponseAt" IS NULL AND x.first IS NOT NULL;
-- Phiếu cũ đã qua hạn từ trước: không leo thang hồi tố, tránh thư dồn dập ngày đầu.
UPDATE "Ticket" SET "escalation" = 2 WHERE "escalation" = 0 AND "createdAt" < NOW() - INTERVAL '1 day';

GRANT SELECT, INSERT, UPDATE, DELETE ON "TicketTeam", "TicketTeamMember", "TicketRole" TO ticket_app;

COMMIT;

-- Kiểm nhanh
SELECT name FROM "TicketTeam" ORDER BY "sortOrder";
SELECT key, "defaultTeam", "unitRoute", "approval" IS NOT NULL AS can_duyet FROM "TicketForm" ORDER BY "sortOrder";
