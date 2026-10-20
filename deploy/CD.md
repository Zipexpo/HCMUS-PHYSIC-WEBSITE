# CD — tự động triển khai sandbox khi push `main`

Luồng: push `main` → GitHub Actions build 3 ảnh (backend/admin/public) → push lên
GHCR → SSH vào sandbox `pull` + `up -d` + `db push` + flush Redis → smoke test.
File liên quan: `.github/workflows/deploy.yml`, `docker-compose.deploy.yml`.

## Vì sao thiết kế thế này
- Box **không build được** ảnh tại chỗ (CentOS 7.9, storage driver `vfs`, đĩa ~18 GB —
  build `public` là cạn đĩa). Nên build ở runner GitHub, box chỉ kéo ảnh.
- Build `public` từng **treo vì prerender `sitemap.xml`** gọi API remote; đã thêm timeout
  8 s trong `frontend-public/src/app/sitemap.ts` → không có backend lúc build vẫn xong,
  ISR (revalidate 300 s) tự dựng lại sitemap khi chạy.
- Font đã **self-host** (không phụ thuộc mạng Google lúc build).

## KHÔNG nằm trong CD (làm tay, một lần)
- `db:seed-all` (deploy chỉ `prisma db push` — schema; re-seed sẽ ghi đè nội dung đã biên tập).
- Kho media `backend/uploads` (bind-mount, tồn tại qua mỗi lần deploy).
- Các script vá dữ liệu (cover, prune-nav, localize ảnh, revamp học bổng).
- ⚠️ `prisma db push` có thể **drop cột** nếu đổi schema phá vỡ — rà kỹ thay đổi schema trước khi merge lên main.

## Cần thiết lập một lần (phía bạn — GitHub UI)
Repo → Settings → Secrets and variables → Actions.

**Variables** (tab *Variables*):
| Tên | Giá trị |
|---|---|
| `PUBLIC_API_URL` | `http://103.88.122.23:3001` |
| `PUBLIC_SITE_URL` | `http://103.88.122.23:3002` |

**Secrets** (tab *Secrets*):
| Tên | Giá trị |
|---|---|
| `SANDBOX_HOST` | `103.88.122.23` |
| `SANDBOX_PORT` | `63379` |
| `SANDBOX_USER` | `vlkt` |
| `SANDBOX_SSH_KEY` | **private key** của cặp khóa deploy (xem bên dưới) |
| `GHCR_PULL_TOKEN` | GitHub PAT (classic) quyền `read:packages` — để box kéo ảnh |

### Tạo khóa SSH cho deploy
```bash
ssh-keygen -t ed25519 -f deploy_key -N "" -C "gh-actions-deploy"
# thêm public key vào box:
ssh -p 63379 vlkt@103.88.122.23 'mkdir -p ~/.ssh && cat >> ~/.ssh/authorized_keys' < deploy_key.pub
# dán NỘI DUNG deploy_key (private) vào secret SANDBOX_SSH_KEY, rồi xóa file local.
```

### Tạo GHCR pull token
GitHub → Settings (cá nhân) → Developer settings → Tokens (classic) → generate,
tick `read:packages` → dán vào secret `GHCR_PULL_TOKEN`.
Lần đầu package còn private, cần token này; có thể đổi package sang public để bỏ bước login.

## Kích hoạt
1. Đặt xong Variables + Secrets ở trên **trước khi** merge lên main (nếu không, job deploy
   của lần push đầu sẽ đỏ — vô hại, chạy lại sau).
2. Merge nhánh chứa CD lên `main` (hoặc Actions → *Deploy (sandbox)* → *Run workflow* để chạy tay).
3. Theo dõi ở tab Actions; smoke test cuối xác nhận `/vi` = 200.

## Rollback
Ảnh gắn thêm tag `:<git-sha>`. Trên box:
```bash
cd ~/hcmus-cms
# sửa docker-compose.deploy.yml trỏ :latest -> :<sha cũ>  (hoặc pull tag đó và up)
docker compose -f docker-compose.deploy.yml up -d
```
DB: backup gần nhất ở `~/backup-*.sql.gz` (xem progress.md).
