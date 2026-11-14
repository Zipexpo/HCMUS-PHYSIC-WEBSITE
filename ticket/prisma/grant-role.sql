-- Cấp quyền cho ticket_app TRÊN CSDL hcmus_ticket.
--
-- Chạy SAU create-role.sql, và phải chạy với -d hcmus_ticket:
--   docker exec -i hcmus-cms-db-1 psql -U physics -d hcmus_ticket -v ON_ERROR_STOP=1 \
--     -f /tmp/grant-role.sql
--
-- QUYỀN TỐI THIỂU: chỉ đọc/ghi dữ liệu, KHÔNG cho tạo hay xoá bảng.
-- Mọi thay đổi lược đồ đi qua psql bằng tài khoản quản trị, nên ứng dụng không
-- cần quyền CREATE — mà không có quyền đó thì một lỗ hổng trong ứng dụng cũng
-- không thể dựng bảng lạ hay xoá bảng thật.

GRANT USAGE ON SCHEMA public TO ticket_app;

-- Các bảng đã tạo.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ticket_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ticket_app;

-- Bảng tạo SAU này (khi thêm tính năng) cũng tự có quyền, khỏi phải nhớ chạy
-- lại lệnh cấp quyền rồi ngồi dò vì sao ứng dụng báo "permission denied".
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ticket_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO ticket_app;

-- Kiểm nhanh: phải thấy 6 bảng.
-- Dùng format('%I.%I') chứ KHÔNG nối chuỗi thường: tên bảng do Prisma sinh ra
-- viết hoa chữ đầu (TicketCounter), nối trần thì Postgres hạ thành chữ thường
-- rồi báo "relation does not exist".
SELECT tablename AS "bang", 
       has_table_privilege('ticket_app', format('%I.%I', schemaname, tablename), 'SELECT') AS "doc",
       has_table_privilege('ticket_app', format('%I.%I', schemaname, tablename), 'INSERT') AS "ghi"
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY 1;
