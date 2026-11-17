# Physupport — hệ phiếu hỗ trợ kỹ thuật, Khoa Vật lý – Vật lý Kỹ thuật

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

Mọi luật ở MỘT tệp: [`src/lib/access.ts`](src/lib/access.ts).

| Vai trò | Là ai | Được làm gì |
|---|---|---|
| Người gửi | mọi tài khoản web Khoa | gửi, theo dõi, trao đổi trên phiếu của mình; mở lại khi vẫn còn lỗi; chấm điểm |
| Đầu mối đơn vị | ADMIN bên CMS có gắn đơn vị (tự động) | XEM phiếu người đơn vị mình gửi; DUYỆT xin cấp quyền; XỬ LÝ phiếu "chuyển qua đơn vị" (sửa nội dung trang đơn vị) |
| Thành viên nhóm | thêm ở trang **Nhóm** | xử lý phiếu của nhóm mình; chỉ tự nhận / bỏ nhận |
| Trưởng nhóm | thêm ở trang **Nhóm** | + giao việc, chuyển nhóm, sửa mẫu biểu của nhóm, đặt thông báo sự cố, nhận cảnh báo quá hạn |
| Quản trị hệ thống | SUPER_ADMIN bên CMS, hoặc gán ở trang **Nhóm** | toàn quyền |
| Ban Chủ nhiệm | gán ở trang **Nhóm** | Báo cáo + phiếu bị leo thang; không đọc ghi chú nội bộ |

Làm ADMIN bên CMS **không** tự động là người xử lý. Ghi chú nội bộ lọc **ở máy
chủ**, không phải ẩn bằng CSS.

Luồng chính:
- **Duyệt cấp quyền** — mẫu biểu có luật duyệt (ô chọn + các lựa chọn cần duyệt):
  phiếu chờ đầu mối đơn vị của người gửi duyệt; đơn vị chưa có đầu mối → quản
  trị duyệt thay; đầu mối tự gửi cho đơn vị mình → coi như đã duyệt.
- **Thời hạn & leo thang** ([`src/lib/sla.ts`](src/lib/sla.ts), giờ hành chính):
  quá hạn phản hồi → trưởng nhóm; quá hạn xử lý → + quản trị; phiếu Khẩn → + Ban Chủ nhiệm.
- **Thư tóm tắt sáng** ([`src/lib/digest.ts`](src/lib/digest.ts)) ngày làm việc từ
  7:30, mỗi ngày một lần; thứ Hai có tổng kết tuần cho Ban Chủ nhiệm. Không có gì
  đáng báo thì không gửi.
- **Thông báo sự cố chung** đầu mọi trang — quản trị / trưởng nhóm đặt và gỡ.

Không có cron: leo thang, tự đóng phiếu, thư tóm tắt chạy "lười" khi có người vào
trang (mỗi 10 phút tối đa một lần).

## Kiểm thử theo vai trò

```bash
ticket/e2e/run.sh              # build ảnh, dựng hệ chạy thử riêng, chạy, gỡ
KEEP=1 ticket/e2e/run.sh       # giữ lại để mở http://localhost:3199/ho-tro
```

Dựng CSDL trống bằng ĐÚNG các tệp SQL dùng trên máy chủ (`setup.sql` rồi
`migrate-00x.sql`), một CMS giả có 8 tài khoản đóng 8 vai, rồi đi qua mọi trang
và thao tác: ai mở được trang nào, ai thấy / làm được gì, thư báo tới đúng người
(chế độ `TICKET_MAIL_DRYRUN=1` ghi thư ra log thay vì gửi). Thêm tính năng mới thì
thêm bước vào [`e2e/roles.e2e.mjs`](e2e/roles.e2e.mjs). Chạy trên máy phát triển,
**không** chạy trên máy chủ thật.

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

- **Ngày lễ** chưa trừ khỏi thời hạn — thêm vào `HOLIDAYS` trong `src/lib/sla.ts`.
- **SSO PHYsoom.** Backend đã có `POST /auth/sso/physoom`, nhưng còn hai việc:
  cho nó nhận nhiều `aud` (hiện khoá cứng một giá trị), và đăng ký
  `redirect_uri` mới bên PHYsoom — việc đó phải nhờ bên PHYsoom.
- **Bản ghi DNS cho hcmus.edu.vn trên Resend.** Chưa có thì thư đi từ tên miền
  lạ, dễ vào thư rác và trông như lừa đảo.
