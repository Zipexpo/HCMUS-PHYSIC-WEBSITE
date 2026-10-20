#!/usr/bin/env python3
"""Đẩy image đã build lên sandbox rồi recreate service.

Dùng qua deploy/build-deploy.sh, không gọi trực tiếp.

    deploy-sandbox.py <file.tar.gz> <service...>

Việc nó làm: sftp image → docker load → compose up --force-recreate các service →
FLUSHALL redis → xoá cache render của Next (GIỮ cache ảnh đã tối ưu, mất là phải
tối ưu lại nguội ~1s/ảnh) → prune image cũ.

Cần mật khẩu ở ~/.hcmus-sbpass.
"""
import os
import sys
import time

import paramiko

HOST, PORT, USER = "103.88.122.23", 63379, "vlkt"
REMOTE_DIR = "/home/vlkt/hcmus-cms"
COMPOSE = f"docker compose -f {REMOTE_DIR}/docker-compose.sandbox.yml"

if len(sys.argv) < 3:
    sys.exit(__doc__)
archive, services = sys.argv[1], sys.argv[2:]

pw = open(os.path.expanduser("~/.hcmus-sbpass")).read().strip()
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(HOST, port=PORT, username=USER, password=pw, timeout=30)


def sh(cmd: str, timeout: int = 1200) -> str:
    _, out, err = c.exec_command(cmd, timeout=timeout)
    return out.read().decode() + err.read().decode()


# Ổ GỐC của box (47G) chứa cả docker.img 32G, nên nó đầy trước ổ docker rất
# nhiều. Trước đây script chỉ in df của /var/lib/docker nên ổ gốc âm thầm đầy
# 100% và sftp chết giữa chừng với "OSError: Failure" — nhìn log không ra bệnh.
need_mb = os.path.getsize(archive) // 1048576 + 200
free_mb = int(sh("df -Pm / | awk 'NR==2{print $4}'").strip() or 0)
print(f"o goc con trong {free_mb}MB, can it nhat {need_mb}MB", flush=True)
if free_mb < need_mb:
    raise SystemExit(
        f"DUNG: o goc chi con {free_mb}MB, khong du cho goi {need_mb - 200}MB.\n"
        "Don bot roi chay lai: xoa tarball cu o /home/vlkt, `yum clean all`, "
        "hoac bot ban sao cu trong /home/vlkt/db-backups."
    )

# Và ổ gốc KHÔNG phải chỗ ảnh docker nằm. `docker load` ghi vào /var/lib/docker,
# vốn là một loopback 32G RIÊNG. Ngày 2026-08-22 ổ gốc còn 2.2G nên kiểm tra ở
# trên cho qua, trong khi loopback đã 0 byte — Postgres không ghi nổi tệp
# checkpoint, PANIC, rồi lặp vòng khởi động lại khoảng 2 lần/giây. Cả web Khoa
# chết cho tới khi dọn chỗ. Nạp ảnh cần chỗ cho bản GIẢI NÉN, nên đòi rộng tay.
DOCKER_FLOOR_MB = 4000
need_dk = max(need_mb * 3, DOCKER_FLOOR_MB)
free_dk = int(sh("df -Pm /var/lib/docker | awk 'NR==2{print $4}'").strip() or 0)
print(f"o docker con trong {free_dk}MB, can it nhat {need_dk}MB", flush=True)
if free_dk < need_dk:
    raise SystemExit(
        f"DUNG: /var/lib/docker chi con {free_dk}MB, can {need_dk}MB.\n"
        "Nap anh vao day se lam DAY o va HA CSDL. Don truoc roi chay lai:\n"
        "  docker image prune -f                       # anh mo coi\n"
        "  docker builder prune -f --keep-storage 2GB  # cache dung anh\n"
        "KHONG dung `docker system prune --volumes`: CSDL nam trong volume."
    )

t0 = time.time()
sf = c.open_sftp()
sf.put(archive, "/tmp/deploy.tar.gz")
sf.close()
print(f"uploaded {os.path.getsize(archive) // 1048576}MB in {int(time.time() - t0)}s", flush=True)

print(sh("gunzip -c /tmp/deploy.tar.gz | docker load 2>&1 | tail -4"), flush=True)
print(sh(f"cd {REMOTE_DIR} && {COMPOSE} up -d --no-deps --no-build --force-recreate {' '.join(services)} 2>&1 | tail -10"), flush=True)
print(sh("docker exec hcmus-cms-redis-1 redis-cli FLUSHALL"), flush=True)
print(
    sh(
        "docker exec hcmus-cms-public-1 sh -c 'find /app/frontend-public/.next/cache "
        "-mindepth 1 -maxdepth 1 ! -name images -exec rm -rf {} + 2>/dev/null'"
    ),
    flush=True,
)
# `image prune` KHÔNG đụng tới cache dựng ảnh — hôm 22/8 nó chỉ đòi lại được
# 966MB trong khi cache ôm 9.67GB. Dọn cả hai, giữ 2GB cache mới nhất để lần
# dựng sau còn nhanh.
print(
    sh(
        "docker image prune -f 2>&1 | tail -1; "
        "docker builder prune -f --keep-storage 2GB 2>&1 | tail -1; "
        "rm -f /tmp/deploy.tar.gz; df -h / /var/lib/docker | tail -2"
    ),
    flush=True,
)
print(sh(f"cd {REMOTE_DIR} && {COMPOSE} ps {' '.join(services)} --format '{{{{.Service}}}} {{{{.Status}}}}'"), flush=True)
print("DEPLOY_DONE", flush=True)
c.close()
