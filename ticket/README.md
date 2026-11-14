# Hệ phiếu hỗ trợ kỹ thuật — Khoa Vật lý

Nơi cán bộ của Khoa báo sự cố phần mềm và theo dõi tới khi xong.

## Vì sao tách riêng

Độc lập với web Khoa: **cơ sở dữ liệu riêng** (`hcmus_ticket`), container riêng,
deploy riêng. Hỏng hay nâng cấp bên này không ảnh hưởng CMS, và ngược lại.

Nhưng **dùng chung máy chủ Postgres** thay vì dựng thêm một container CSDL —
đĩa máy chủ đang ở mức 92%, mỗi container mới là một khoản không nhỏ.

Và **không có bảng người dùng riêng**. Thầy cô đã có tài khoản trên trang quản
trị web Khoa; bắt nhớ thêm một mật khẩu nữa là cách chắc chắn khiến không ai
dùng. Hệ này gọi sang `/auth/login` của backend CMS để xác thực, chỉ lưu lại
tên + email tại thời điểm gửi phiếu.

## Kiến trúc

```
Trình duyệt → Caddy → /ho-tro/* → ticket:3003 (Next.js App Router)
                                      ├─ Prisma → Postgres  (CSDL hcmus_ticket)
                                      └─ fetch  → backend:3001  (xác thực)
```

Một container duy nhất, giới hạn 512MB RAM. Next App Router đảm nhiệm cả giao
diện lẫn API nên không cần thêm NestJS.

## Mẫu biểu định nghĩa bằng DỮ LIỆU

Loại yêu cầu nằm trong bảng `TicketForm`, các ô nhập riêng của từng loại nằm
trong cột `fields` (JSON). Thêm loại mới (đặt phòng, xin giấy tờ…) chỉ cần thêm
một dòng — **không phải sửa code và deploy lại**.

Ví dụ một ô:

```json
{ "key": "he_thong", "label": "Hệ thống gặp lỗi", "type": "select",
  "required": true, "options": ["Web Khoa", "Trang quản trị", "Chatbot"] }
```

Kiểu hỗ trợ: `text`, `textarea`, `select`, `date`, `checkbox`.

## Phân quyền

| | Người gửi | Quản trị viên |
|---|---|---|
| Xem phiếu | chỉ của mình | tất cả |
| Đổi trạng thái | chỉ **đóng** phiếu của mình | mọi trạng thái |
| Nhận phiếu, đổi mức độ | không | có |
| Ghi chú nội bộ | không thấy | viết và đọc được |

Ghi chú nội bộ được lọc **ở máy chủ**, không phải ẩn bằng CSS — người gửi không
có cách nào đọc được.

## Cài lần đầu

**1. Tạo CSDL riêng** (chạy trên máy chủ):

```bash
docker exec hcmus-cms-db-1 psql -U physics -d postgres -c 'CREATE DATABASE hcmus_ticket;'
```

**2. Build và chạy:**

```bash
docker compose -f docker-compose.sandbox.yml build ticket
docker compose -f docker-compose.sandbox.yml up -d --no-deps ticket
```

**3. Tạo bảng + mẫu biểu ban đầu.**

Ảnh chạy thật là Next standalone, **không kèm Prisma CLI** (cố ý — kèm vào thì
ảnh phình thêm hàng trăm MB). Nên chạy bằng SQL:

```bash
docker cp ticket/prisma/setup.sql hcmus-cms-db-1:/tmp/setup.sql
docker exec hcmus-cms-db-1 psql -U physics -d hcmus_ticket -v ON_ERROR_STOP=1 -f /tmp/setup.sql
```

`setup.sql` sinh ra từ chính `schema.prisma` và `seed.ts`, nên không bao giờ
lệch với mã nguồn. Sinh lại sau khi đổi lược đồ:

```bash
corepack pnpm --filter ticket exec prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script > ticket/prisma/init.sql
corepack pnpm --filter ticket exec tsx prisma/seed.ts --sql >> ticket/prisma/setup.sql
```

**3b. Tài khoản CSDL riêng** (quyền tối thiểu — xem `prisma/create-role.sql`):

```bash
read -rsp 'Mat khau ticket_app: ' PW && echo
docker exec -i -e PW="$PW" hcmus-cms-db-1 psql -U physics -d postgres -v ON_ERROR_STOP=1 -f - < ticket/prisma/create-role.sql
docker exec -i hcmus-cms-db-1 psql -U physics -d hcmus_ticket -v ON_ERROR_STOP=1 -f - < ticket/prisma/grant-role.sql
printf 'TICKET_DB_PASSWORD=%s
' "$PW" >> .env && unset PW
```

**4. Nạp lại Caddy** để tuyến `/ho-tro` có hiệu lực.

⚠️ Phải **restart**, không phải `caddy reload`. Caddyfile gắn vào container theo
kiểu bind-mount một tệp đơn; mỗi lần deploy thay mới tệp là container vẫn bám
vào tệp cũ, nên `reload` sẽ nạp lại đúng cấu hình cũ.

Kiểm cú pháp TRƯỚC, bằng một container dùng một lần — restart vào cấu hình hỏng
là web Khoa chết:

```bash
docker run --rm -v ~/hcmus-cms/deploy/Caddyfile:/etc/caddy/Caddyfile:ro caddy:2 caddy validate --config /etc/caddy/Caddyfile
docker compose -f docker-compose.sandbox.yml restart caddy
```

Xong, vào `https://phys.hcmus.edu.vn/ho-tro`.

## Phát triển tại máy

```bash
corepack pnpm --filter ticket dev     # http://localhost:3003/ho-tro
```

Cần biến môi trường `TICKET_DATABASE_URL` và `CMS_API_URL` trong `ticket/.env`.

## Đăng nhập

Hai cách, dùng chung tài khoản web Khoa:

| Cách | Hợp với ai |
|---|---|
| **Mã gửi qua email** (mặc định) | Ai có email Khoa — **không cần mật khẩu** |
| Mật khẩu | Quản trị viên |

Mã đăng nhập là loại `LOGIN`, **tách khỏi** mã quên mật khẩu: một mã lọt ra
ngoài cũng chỉ làm được đúng một việc. Dùng xong xoá ngay, chỉ dùng được một lần,
hạn 10 phút.

Gửi thư qua **Resend** (miễn phí 3.000 thư/tháng, 100/ngày). Chọn nhà cung cấp
bằng biến môi trường trong `backend/.env`:

```
MAIL_PROVIDER=resend
RESEND_API_KEY=re_...
MAIL_FROM=Khoa Vat ly <no-reply@hcmus.edu.vn>
```

Đổi sang AWS SES thì đặt `MAIL_PROVIDER=ses` — không phải sửa code.

## Chưa có (làm sau)

- Đính kèm tệp: lược đồ CSDL đã có bảng `TicketAttachment` nhưng chưa có phần
  tải lên. Ảnh chụp màn hình giúp sửa lỗi nhanh hơn hẳn, nên đây là việc nên làm
  trước tiên.
- Gửi email báo khi có phiếu mới / khi được trả lời.
- Trang quản lý mẫu biểu trong giao diện (hiện sửa bằng `seed.ts`).
- **SSO PHYsoom.** Backend đã có `POST /auth/sso/physoom`, nhưng còn hai việc:
  cho nó nhận nhiều `aud` (hiện khoá cứng một giá trị), và đăng ký
  `redirect_uri` mới bên PHYsoom — việc đó phải nhờ bên PHYsoom.
- **Bản ghi DNS cho hcmus.edu.vn trên Resend.** Chưa có thì thư đi từ tên miền
  lạ, dễ vào thư rác và trông như lừa đảo.
