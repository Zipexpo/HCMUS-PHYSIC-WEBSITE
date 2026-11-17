#!/usr/bin/env bash
# Kiểm thử Physupport theo vai trò: dựng hệ chạy thử riêng → chạy kịch bản → gỡ.
#
#   ticket/e2e/run.sh            build ảnh rồi chạy
#   ticket/e2e/run.sh --no-build dùng ảnh hcmus-ticket:e2e đã có
#   KEEP=1 ticket/e2e/run.sh     chạy xong giữ hệ lại để mở http://localhost:3199/ho-tro
#
# Cần Docker và Node ≥ 18 trên máy chạy. KHÔNG chạy trên máy chủ thật (đĩa đầy).
set -euo pipefail
cd "$(dirname "$0")"
ROOT="$(cd ../.. && pwd)"
COMPOSE=(docker compose -f docker-compose.e2e.yml)

if [[ "${1:-}" != "--no-build" ]]; then
  echo "── build ảnh ticket"
  docker build -q -f "$ROOT/ticket/Dockerfile" -t hcmus-ticket:e2e "$ROOT" >/dev/null
fi

cleanup() { [[ "${KEEP:-}" == "1" ]] || "${COMPOSE[@]}" down -v >/dev/null 2>&1 || true; }
trap cleanup EXIT

"${COMPOSE[@]}" down -v >/dev/null 2>&1 || true
"${COMPOSE[@]}" up -d >/dev/null
echo "── chờ hệ chạy thử sẵn sàng"
for _ in $(seq 1 60); do
  curl -sf -o /dev/null http://localhost:3199/ho-tro/dang-nhap && break
  sleep 1
done

node roles.e2e.mjs
