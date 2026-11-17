-- Các migration GRANT cho ticket_app (tài khoản ứng dụng trên máy chủ thật).
-- Ở hệ chạy thử, ứng dụng nối bằng chủ CSDL, nhưng vai trò vẫn phải tồn tại.
CREATE ROLE ticket_app NOLOGIN;
