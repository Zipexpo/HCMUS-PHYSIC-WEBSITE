-- Hệ ticket — đợt 2: nhóm phụ trách, email báo tin, danh sách người xử lý.
--
-- CHỈ CỘNG THÊM: không sửa, không xoá cột hay bảng nào đang có. Chạy lại được
-- nhiều lần (IF NOT EXISTS, và chỉ điền vào ô còn trống).
--
-- Chạy bằng tài khoản quản trị (physics) để ALTER DEFAULT PRIVILEGES đã đặt
-- ở grant-role.sql tự cấp quyền bảng mới cho ticket_app:
--   docker exec -i hcmus-cms-db-1 psql -U physics -d hcmus_ticket -v ON_ERROR_STOP=1 -f - < ticket/prisma/migrate-002.sql

BEGIN;

ALTER TABLE "Ticket" ADD COLUMN IF NOT EXISTS "team" TEXT;
ALTER TABLE "Ticket" ADD COLUMN IF NOT EXISTS "notifyEmail" BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE IF NOT EXISTS "TicketStaff" (
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "unit" TEXT,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TicketStaff_pkey" PRIMARY KEY ("userId")
);

-- Nhóm phụ trách mặc định cho 4 mẫu biểu ban đầu — theo bản thiết kế.
-- Chỉ điền khi còn trống: quản trị viên đã tự đặt thì giữ nguyên.
UPDATE "TicketForm" SET "defaultTeam" = 'Kỹ thuật web'
  WHERE key IN ('loi-phan-mem', 'de-xuat') AND "defaultTeam" IS NULL;
UPDATE "TicketForm" SET "defaultTeam" = 'Quản trị hệ thống'
  WHERE key = 'tai-khoan' AND "defaultTeam" IS NULL;
UPDATE "TicketForm" SET "defaultTeam" = 'Biên tập web'
  WHERE key = 'sua-noi-dung' AND "defaultTeam" IS NULL;

-- Phiếu đã gửi trước đợt này: nhận nhóm theo mẫu biểu của nó.
UPDATE "Ticket" t SET "team" = f."defaultTeam"
  FROM "TicketForm" f
  WHERE t."formId" = f.id AND t."team" IS NULL AND f."defaultTeam" IS NOT NULL;

-- Phòng khi bảng mới được tạo bởi tài khoản khác physics: cấp lại cho chắc.
GRANT SELECT, INSERT, UPDATE, DELETE ON "TicketStaff" TO ticket_app;

COMMIT;

-- Kiểm nhanh
SELECT key, "defaultTeam" FROM "TicketForm" ORDER BY "sortOrder";
