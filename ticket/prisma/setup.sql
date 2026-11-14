-- Hệ phiếu hỗ trợ — tạo bảng + nạp mẫu biểu. Chạy trên CSDL hcmus_ticket.
-- CHỈ DÙNG KHI CÀI MỚI. Máy chủ đang chạy rồi thì dùng migrate-002.sql.

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "TicketStatus" AS ENUM ('NEW', 'ACKNOWLEDGED', 'IN_PROGRESS', 'WAITING', 'RESOLVED', 'CLOSED', 'REJECTED');

-- CreateEnum
CREATE TYPE "TicketPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');

-- CreateTable
CREATE TABLE "TicketForm" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "icon" TEXT,
    "fields" JSONB NOT NULL DEFAULT '[]',
    "defaultTeam" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TicketForm_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Ticket" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "formId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" "TicketStatus" NOT NULL DEFAULT 'NEW',
    "priority" "TicketPriority" NOT NULL DEFAULT 'NORMAL',
    "answers" JSONB NOT NULL DEFAULT '{}',
    "reporterUserId" TEXT NOT NULL,
    "reporterName" TEXT NOT NULL,
    "reporterEmail" TEXT NOT NULL,
    "reporterUnit" TEXT,
    "assigneeUserId" TEXT,
    "assigneeName" TEXT,
    "systemName" TEXT,
    "team" TEXT,
    "notifyEmail" BOOLEAN NOT NULL DEFAULT true,
    "resolvedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Ticket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TicketComment" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "authorUserId" TEXT NOT NULL,
    "authorName" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "isInternal" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TicketComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TicketAttachment" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "commentId" TEXT,
    "url" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeByte" INTEGER NOT NULL,
    "uploadedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TicketAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TicketEvent" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "actorUserId" TEXT,
    "actorName" TEXT,
    "kind" TEXT NOT NULL,
    "fromValue" TEXT,
    "toValue" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TicketEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TicketCounter" (
    "id" TEXT NOT NULL DEFAULT 'main',
    "prefix" TEXT NOT NULL DEFAULT 'VL',
    "value" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "TicketCounter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TicketStaff" (
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "unit" TEXT,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TicketStaff_pkey" PRIMARY KEY ("userId")
);

-- CreateIndex
CREATE UNIQUE INDEX "TicketForm_key_key" ON "TicketForm"("key");

-- CreateIndex
CREATE INDEX "TicketForm_isActive_sortOrder_idx" ON "TicketForm"("isActive", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "Ticket_code_key" ON "Ticket"("code");

-- CreateIndex
CREATE INDEX "Ticket_status_createdAt_idx" ON "Ticket"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Ticket_reporterUserId_createdAt_idx" ON "Ticket"("reporterUserId", "createdAt");

-- CreateIndex
CREATE INDEX "Ticket_assigneeUserId_status_idx" ON "Ticket"("assigneeUserId", "status");

-- CreateIndex
CREATE INDEX "Ticket_formId_idx" ON "Ticket"("formId");

-- CreateIndex
CREATE INDEX "TicketComment_ticketId_createdAt_idx" ON "TicketComment"("ticketId", "createdAt");

-- CreateIndex
CREATE INDEX "TicketAttachment_ticketId_idx" ON "TicketAttachment"("ticketId");

-- CreateIndex
CREATE INDEX "TicketEvent_ticketId_createdAt_idx" ON "TicketEvent"("ticketId", "createdAt");

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_formId_fkey" FOREIGN KEY ("formId") REFERENCES "TicketForm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketComment" ADD CONSTRAINT "TicketComment_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketAttachment" ADD CONSTRAINT "TicketAttachment_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketAttachment" ADD CONSTRAINT "TicketAttachment_commentId_fkey" FOREIGN KEY ("commentId") REFERENCES "TicketComment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketEvent" ADD CONSTRAINT "TicketEvent_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Mẫu biểu ban đầu. Chạy lại được: đã có thì cập nhật.
BEGIN;
INSERT INTO "TicketForm" ("id","key","name","description","icon","fields","sortOrder","defaultTeam","updatedAt")
VALUES ('form_loi-phan-mem', 'loi-phan-mem', 'Báo lỗi phần mềm', 'Chức năng chạy sai, báo lỗi, hiển thị không đúng, hoặc không bấm được.', 'bug', '[{"key":"he_thong","label":"Hệ thống gặp lỗi","type":"select","required":true,"options":["Web Khoa (phys.hcmus.edu.vn)","Trang quản trị (/admin)","Hồ sơ khoa học (phys-profile)","Chatbot","Email / tài khoản","Khác"]},{"key":"duong_dan","label":"Đường dẫn trang gặp lỗi","type":"text","hint":"Dán link trên thanh địa chỉ, ví dụ phys.hcmus.edu.vn/vi/tin-tuc"},{"key":"cac_buoc","label":"Làm thế nào để thấy lỗi","type":"textarea","required":true,"hint":"Bấm gì, nhập gì, rồi lỗi hiện ra. Càng cụ thể càng sửa nhanh."},{"key":"mong_doi","label":"Lẽ ra phải thế nào","type":"textarea"},{"key":"trinh_duyet","label":"Trình duyệt / thiết bị","type":"text","hint":"Ví dụ: Chrome trên Windows, hoặc Safari trên iPhone"}]'::jsonb, 10, 'Kỹ thuật web', NOW())
ON CONFLICT ("key") DO UPDATE SET
  "name"=EXCLUDED."name", "description"=EXCLUDED."description",
  "icon"=EXCLUDED."icon", "fields"=EXCLUDED."fields",
  "sortOrder"=EXCLUDED."sortOrder", "updatedAt"=NOW(),
  "defaultTeam"=COALESCE("TicketForm"."defaultTeam", EXCLUDED."defaultTeam");
INSERT INTO "TicketForm" ("id","key","name","description","icon","fields","sortOrder","defaultTeam","updatedAt")
VALUES ('form_tai-khoan', 'tai-khoan', 'Tài khoản & quyền truy cập', 'Quên mật khẩu, không đăng nhập được, xin cấp tài khoản hoặc xin thêm quyền.', 'key-round', '[{"key":"loai_yeu_cau","label":"Loại yêu cầu","type":"select","required":true,"options":["Không đăng nhập được","Quên mật khẩu","Xin cấp tài khoản mới","Xin thêm quyền","Khoá / thu hồi tài khoản"]},{"key":"he_thong","label":"Hệ thống","type":"select","required":true,"options":["Web Khoa (phys.hcmus.edu.vn)","Trang quản trị (/admin)","Hồ sơ khoa học (phys-profile)","Chatbot","Email / tài khoản","Khác"]},{"key":"email_lien_quan","label":"Email tài khoản liên quan","type":"text","hint":"Nếu xin cho người khác thì ghi email của người đó."}]'::jsonb, 20, 'Quản trị hệ thống', NOW())
ON CONFLICT ("key") DO UPDATE SET
  "name"=EXCLUDED."name", "description"=EXCLUDED."description",
  "icon"=EXCLUDED."icon", "fields"=EXCLUDED."fields",
  "sortOrder"=EXCLUDED."sortOrder", "updatedAt"=NOW(),
  "defaultTeam"=COALESCE("TicketForm"."defaultTeam", EXCLUDED."defaultTeam");
INSERT INTO "TicketForm" ("id","key","name","description","icon","fields","sortOrder","defaultTeam","updatedAt")
VALUES ('form_sua-noi-dung', 'sua-noi-dung', 'Sửa nội dung trên web', 'Thông tin sai, ảnh hỏng, cần thêm/bớt/sửa nội dung trên trang công khai.', 'file-pen', '[{"key":"duong_dan","label":"Đường dẫn trang cần sửa","type":"text","required":true},{"key":"noi_dung_sai","label":"Chỗ nào đang sai","type":"textarea","required":true},{"key":"noi_dung_dung","label":"Nội dung đúng là gì","type":"textarea","required":true,"hint":"Ghi rõ chữ cần thay, để người sửa khỏi đoán."},{"key":"han_chot","label":"Cần xong trước ngày","type":"date"}]'::jsonb, 30, 'Biên tập web', NOW())
ON CONFLICT ("key") DO UPDATE SET
  "name"=EXCLUDED."name", "description"=EXCLUDED."description",
  "icon"=EXCLUDED."icon", "fields"=EXCLUDED."fields",
  "sortOrder"=EXCLUDED."sortOrder", "updatedAt"=NOW(),
  "defaultTeam"=COALESCE("TicketForm"."defaultTeam", EXCLUDED."defaultTeam");
INSERT INTO "TicketForm" ("id","key","name","description","icon","fields","sortOrder","defaultTeam","updatedAt")
VALUES ('form_de-xuat', 'de-xuat', 'Đề xuất cải tiến', 'Góp ý thêm chức năng mới hoặc làm cho thứ đang có dễ dùng hơn.', 'lightbulb', '[{"key":"he_thong","label":"Hệ thống","type":"select","required":true,"options":["Web Khoa (phys.hcmus.edu.vn)","Trang quản trị (/admin)","Hồ sơ khoa học (phys-profile)","Chatbot","Email / tài khoản","Khác"]},{"key":"van_de","label":"Hiện nay đang bất tiện chỗ nào","type":"textarea","required":true},{"key":"de_xuat","label":"Đề xuất của thầy/cô","type":"textarea"}]'::jsonb, 40, 'Kỹ thuật web', NOW())
ON CONFLICT ("key") DO UPDATE SET
  "name"=EXCLUDED."name", "description"=EXCLUDED."description",
  "icon"=EXCLUDED."icon", "fields"=EXCLUDED."fields",
  "sortOrder"=EXCLUDED."sortOrder", "updatedAt"=NOW(),
  "defaultTeam"=COALESCE("TicketForm"."defaultTeam", EXCLUDED."defaultTeam");
INSERT INTO "TicketCounter" ("id","prefix","value") VALUES ('main','VL',0)
ON CONFLICT ("id") DO NOTHING;
COMMIT;
