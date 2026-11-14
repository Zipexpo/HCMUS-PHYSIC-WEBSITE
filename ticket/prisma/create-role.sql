-- Tài khoản Postgres RIÊNG cho hệ ticket.
--
-- Mục đích: hệ ticket chỉ đụng được đúng CSDL của nó. Dù code có lỗi hay bị lợi
-- dụng, nó không đọc nổi một dòng nào của web Khoa.
--
-- MẬT KHẨU KHÔNG NẰM TRONG TỆP NÀY. Nó được đọc từ biến môi trường PW ngay lúc
-- chạy, nên không rơi vào đĩa, không vào git, không vào lịch sử shell, và không
-- hiện trong `ps` như khi truyền bằng tham số dòng lệnh.
--
-- Chạy:
--   read -rsp 'Mat khau cho ticket_app: ' PW && echo
--   docker exec -i -e PW="$PW" hcmus-cms-db-1 \
--     psql -U physics -d postgres -v ON_ERROR_STOP=1 -f - < ticket/prisma/create-role.sql
--
-- GHI CHÚ VỀ PHẠM VI: cố ý KHÔNG REVOKE gì trên hcmus_physics.
-- PostgreSQL 16 đã bỏ quyền CREATE mặc định của PUBLIC trên schema public, và
-- quyền trên BẢNG vốn chưa bao giờ cấp cho PUBLIC. Nên ticket_app nhiều nhất
-- chỉ mở được kết nối tới hcmus_physics chứ không đọc được dữ liệu. Đổi lại,
-- REVOKE trên CSDL đang chạy thật là thao tác dễ làm gãy CMS — không đáng.

\getenv pw PW
\if :{?pw}
\else
\echo 'LỖI: chưa đặt biến môi trường PW.'
\quit 1
\endif

-- Chạy lại được: đã có thì chỉ đổi mật khẩu. Chỉ LOGIN — không CREATEDB,
-- không SUPERUSER.
SELECT NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ticket_app') AS can_tao
\gset

\if :can_tao
CREATE ROLE ticket_app LOGIN PASSWORD :'pw';
\echo 'Đã tạo tài khoản ticket_app.'
\else
ALTER ROLE ticket_app LOGIN PASSWORD :'pw';
\echo 'Tài khoản ticket_app đã có — chỉ đổi mật khẩu.'
\endif

-- Cho phép kết nối ĐÚNG CSDL của hệ ticket.
GRANT CONNECT ON DATABASE hcmus_ticket TO ticket_app;
