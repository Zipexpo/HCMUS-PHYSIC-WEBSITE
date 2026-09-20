-- MỐC CHỐT THỰC TẾ của đề tài: tháng nghiệm thu, hoặc tháng khai không hoàn thành.
--
-- start/end chỉ là KẾ HOẠCH. Phụ lục 2 tr. 2.7 chia đều giờ cho từng tháng rồi
-- mỗi năm học lấy phần rơi vào nó, nên đề tài 2/2025 → 2/2027 nghiệm thu
-- 10/2026 vẫn bị chia đều tới 2/2027: giờ của mấy tháng cuối nằm ở năm học
-- 2026-2027, một năm mà đề tài đã đóng xong.
--
-- Khoa chốt 20/9/2026: nghiệm thu SỚM thì dồn toàn bộ phần còn lại vào năm học
-- chứa tháng này (năm sau không tính nữa, tổng giờ không đổi); TRỄ hạn thì chỉ
-- ghi nhận; KHÔNG hoàn thành thì cắt cụt tại đây. Phép cắt nằm bên ACADsoom
-- (catThang trong lib/namHoc.js).
--
-- Cộng thêm, chạy lại được nhiều lần — KHÔNG dùng `prisma db push` trên box:
-- push so cả schema với CSDL và sẽ xoá bảng ChatbotChunk (xem db-setup trong
-- docker-compose.sandbox.yml).
ALTER TABLE "ResearchProject"
  ADD COLUMN IF NOT EXISTS "finishedYear" INTEGER,
  ADD COLUMN IF NOT EXISTS "finishedMonth" INTEGER;
