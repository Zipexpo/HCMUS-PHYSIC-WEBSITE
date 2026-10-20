# Website Khoa Vật lý – Vật lý Kỹ thuật (HCMUS)

Hệ thống quản trị nội dung (CMS) cho website Khoa Vật lý – Vật lý Kỹ thuật, Trường Đại học Khoa học Tự nhiên – ĐHQG TP.HCM.

- **Trang công khai (người xem):** https://phys.hcmus.edu.vn  *(HTTPS, không cần gõ cổng)*
- **Trang quản trị (admin):** https://phys.hcmus.edu.vn:3000  *(HTTPS qua Caddy — xem mục 4.5)*
- **API (backend):** https://phys.hcmus.edu.vn/be  *(nội bộ, trang công khai tự gọi)*

---

## 1. Tổng quan kiến trúc

Dự án là một **pnpm monorepo** gồm 3 thành phần chạy bằng Docker:

| Thành phần | Thư mục | Vai trò | Cổng nội bộ |
|---|---|---|---|
| **backend** | `backend/` | API (NestJS) + xác thực + kết nối CSDL | 3001 |
| **admin** | `frontend/` | Trang quản trị (Next.js), soạn bài & bố cục | 3000 |
| **public** | `frontend-public/` | Trang công khai (Next.js) | 3002 |

Hạ tầng đi kèm: **PostgreSQL** (CSDL), **Redis** (bộ nhớ đệm). Toàn bộ chạy qua `docker-compose.sandbox.yml`.

Chi tiết mô-đun và luồng bài viết → bố cục → trang công khai: xem `docs/architecture.md`.

---

## 2. Đăng nhập quản trị

- **Địa chỉ:** https://phys.hcmus.edu.vn:3000
- **Tài khoản Super Admin:** `admin@hcmus.edu.vn`
- **Mật khẩu:** *(được bàn giao riêng — vui lòng đổi ngay sau lần đăng nhập đầu tiên)*

Ngoài Super Admin (toàn quyền, phạm vi toàn Khoa) còn có các tài khoản **admin bộ môn** (chỉ quản lý nội dung của bộ môn mình). Super Admin có thể tạo/khoá tài khoản trong mục **Quản trị viên**.

### Đổi mật khẩu / tạo tài khoản
Trong trang quản trị → mục **Quản trị viên (Admins)** → chọn tài khoản → *Đặt lại mật khẩu*, hoặc *Thêm quản trị viên* để tạo tài khoản mới (gán bộ môn nếu là admin bộ môn).

---

## 3. Sử dụng cơ bản

### 3.1. Đăng một bài viết
1. Vào **Bài viết → Tạo bài** → nhập tiêu đề, nội dung (trình soạn thảo trực quan), ảnh bìa, danh mục, ngày đăng.
2. Lưu bài (trạng thái *Nháp*).
3. Bài viết được gắn vào một **bố cục (layout)**; khi **Xuất bản / Hẹn giờ** bố cục thì bài mới hiện ra trang công khai.

> Thứ tự tin tức ở trang chủ sắp theo **ngày đăng gốc** (mới viết trước), không theo ngày chỉnh sửa.

### 3.2. Chỉnh sửa bố cục trang (Puck)
- **Bố cục (Layouts)** dùng trình kéo–thả **Puck**: chọn layout → kéo các widget (Navbar, Hero, Tin tức, Lãnh đạo, Footer…) → chỉnh trực tiếp → **Lưu** → **Xuất bản**.
- Trang mỗi bộ môn, trang giới thiệu, học bổng… đều là các layout riêng.
- **Thùng rác:** bài/layout đã xoá được giữ 30 ngày, có thể khôi phục.

### 3.3. Ngôn ngữ
Hầu hết nội dung song ngữ **Việt / Anh**; nhập cả hai khi soạn để trang công khai chuyển ngữ đúng.

---

## 4. Vận hành máy chủ

Máy chủ chạy Docker Compose. Truy cập SSH và các lệnh quản trị do bộ phận kỹ thuật của Khoa giữ.

### 4.0. HTTPS / tên miền (Caddy)
Trang công khai chạy sau reverse proxy **Caddy** (container `hcmus-caddy`), lắng nghe cổng **80/443**, tự động xin và gia hạn chứng chỉ **Let's Encrypt** cho `phys.hcmus.edu.vn`. Cấu hình: `deploy/Caddyfile`. Định tuyến: `/be/*` → backend, `/uploads/*` → backend, còn lại → trang công khai. Caddy đặt `--restart unless-stopped` nên tự bật lại sau khi máy chủ khởi động.

### 4.1. Các lệnh thường dùng (trên máy chủ)
```bash
cd /home/vlkt/hcmus-cms

# Xem trạng thái các container
docker compose -f docker-compose.sandbox.yml ps

# Khởi động / dừng / khởi động lại
docker compose -f docker-compose.sandbox.yml up -d
docker compose -f docker-compose.sandbox.yml restart <backend|public|admin|db>

# Xem log
docker logs --tail 100 hcmus-cms-backend-1
```

### 4.2. Sao lưu cơ sở dữ liệu (QUAN TRỌNG)
```bash
# Sao lưu
docker exec hcmus-cms-db-1 pg_dump -U physics hcmus_physics > backup_$(date +%F).sql
# Phục hồi
cat backup_YYYY-MM-DD.sql | docker exec -i hcmus-cms-db-1 psql -U physics -d hcmus_physics
```
Nên đặt lịch sao lưu định kỳ (cron) và lưu ra nơi khác.

### 4.3. Theo dõi dung lượng đĩa (LƯU Ý)
Docker chạy trên phân vùng riêng; **đầy đĩa sẽ làm CSDL ngừng hoạt động**. Kiểm tra định kỳ và dọn dẹp an toàn:
```bash
df -h /var/lib/docker
docker image prune -a -f        # xoá image không dùng (AN TOÀN)
docker builder prune -a -f      # xoá cache build (AN TOÀN)
# TUYỆT ĐỐI KHÔNG chạy: docker volume prune  (sẽ xoá dữ liệu CSDL)
```

### 4.4. Ảnh/tệp tải lên
Tệp người dùng tải lên nằm ở `backend/uploads` (gắn bind-mount), được backend phục vụ tại `/uploads/...`. Sao lưu thư mục này cùng CSDL.

---

## 5. Triển khai lại sau khi sửa mã nguồn

Yêu cầu: Node ≥ 20, pnpm, Docker.

```bash
pnpm install
pnpm run build          # build cả 3 workspace
# Build image và nạp lên máy chủ (xem thư mục deploy/ để biết quy trình chi tiết)
```
Biến môi trường build cho front-end (đã cấu hình sẵn):
```
NEXT_PUBLIC_SITE_URL=https://phys.hcmus.edu.vn
NEXT_PUBLIC_API_URL=https://phys.hcmus.edu.vn/be
NEXT_PUBLIC_IMAGE_FETCH_ORIGIN=http://backend:3001
```

### 4.5. Trang quản trị chạy HTTPS
Admin được phục vụ qua Caddy ở **https://phys.hcmus.edu.vn:3000** (Caddy giữ cổng 3000 trên host — container admin KHÔNG map cổng 3000 nữa; Caddy proxy nội bộ tới `admin:3000`). App tự chuyển `/` → `/admin` nên chỉ cần gõ `:3000`. Có thêm `:8443` làm dự phòng. Bắt buộc HTTPS vì trình duyệt tự nâng http→https; admin build với API `https://phys.hcmus.edu.vn/be` để tránh mixed-content.

*(Muốn URL không cần cổng: thêm DNS `admin.phys.hcmus.edu.vn → 103.88.122.23` rồi thêm khối `admin.phys.hcmus.edu.vn { reverse_proxy admin:3000 }` vào `deploy/Caddyfile`.)*

---

## 6. Công nghệ sử dụng

- **Backend:** NestJS, Prisma ORM, PostgreSQL, Redis, xác thực bằng mật khẩu băm bcrypt.
- **Frontend:** Next.js (App Router), TailwindCSS, trình kéo–thả Puck, trình soạn thảo Tiptap.
- **Hạ tầng:** Docker Compose; reverse proxy Caddy (tự động HTTPS Let's Encrypt) cho `phys.hcmus.edu.vn`.

---

## 7. Cấu trúc thư mục

```
backend/           API NestJS + Prisma (prisma/schema.prisma)
frontend/          Trang quản trị (Next.js)
frontend-public/   Trang công khai (Next.js)
docs/              Tài liệu kiến trúc
deploy/            Script/ghi chú triển khai
docker-compose.sandbox.yml   Định nghĩa dịch vụ đang chạy
```

---

*Bàn giao cho Văn phòng Khoa Vật lý – Vật lý Kỹ thuật, tháng 7/2026.*
