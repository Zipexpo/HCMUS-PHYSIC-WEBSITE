#!/usr/bin/env bash
# Build admin + backend LOCALLY and ship to the sandbox (the box can't build:
# vfs storage driver + small disk). Public is NOT rebuilt this round (no change).
#
# Usage:
#   bash deploy/ship-sandbox.sh
#   # password: enter interactively at the ssh/scp prompts, OR export SANDBOX_PASS
#   # and install `sshpass` for non-interactive runs.
#
# Assumes the box compose project is "hcmus-cms" (container names hcmus-cms-*-1),
# so `docker compose up --no-build` expects images named hcmus-cms-{admin,backend}.
set -euo pipefail

HOST=103.88.122.23
PORT=63379
USER=vlkt
DIR='~/hcmus-cms'
API=http://103.88.122.23:3001
SITE=http://103.88.122.23:3002
ARCHIVE=/tmp/hcmus-imgs.tar.gz

# sshpass fast-path if SANDBOX_PASS is set and sshpass is installed
SSH="ssh -p $PORT"
SCP="scp -P $PORT"
if [[ -n "${SANDBOX_PASS:-}" ]] && command -v sshpass >/dev/null 2>&1; then
  SSH="sshpass -e ssh -o StrictHostKeyChecking=accept-new -p $PORT"
  SCP="sshpass -e scp -o StrictHostKeyChecking=accept-new -P $PORT"
  export SSHPASS="$SANDBOX_PASS"
fi

echo "==> 1/4  Building images locally (this takes several minutes)…"
docker build --network=host \
  --build-arg NEXT_PUBLIC_API_URL="$API" \
  --build-arg NEXT_PUBLIC_IMAGE_FETCH_ORIGIN=http://backend:3001 \
  --build-arg NEXT_PUBLIC_SITE_URL="$SITE" \
  -t hcmus-cms-admin ./frontend
docker build --network=host -t hcmus-cms-backend ./backend

echo "==> 2/4  Saving + compressing images…"
docker save hcmus-cms-admin hcmus-cms-backend | gzip -1 > "$ARCHIVE"
ls -lh "$ARCHIVE"

echo "==> 3/4  Uploading to $USER@$HOST:/tmp/ …"
$SCP "$ARCHIVE" "$USER@$HOST:/tmp/"

echo "==> 4/4  Loading + recreating (backend, admin) + FLUSHALL Redis…"
$SSH "$USER@$HOST" "cd $DIR && \
  gunzip -c /tmp/hcmus-imgs.tar.gz | docker load && \
  docker compose -f docker-compose.sandbox.yml up -d --no-deps --no-build --force-recreate backend admin && \
  docker exec hcmus-cms-redis-1 redis-cli FLUSHALL && \
  rm -f /tmp/hcmus-imgs.tar.gz && \
  echo 'shipped:' && docker compose -f docker-compose.sandbox.yml ps backend admin"

echo
echo "DONE. Verify:"
echo "  http://103.88.122.23:3000            (admin — Help Center X/VI-EN, guides, composer status)"
echo "  http://103.88.122.23:3002/vi         (public — news feed unchanged; orphan posts now hidden)"
echo
echo "OPTIONAL DB cleanup (NOT required — app runs fine with the inert leftover"
echo "enum value + 2 columns). Do NOT run the db-setup service: it re-seeds and"
echo "would clobber live content. If you want the columns dropped later, run"
echo "prisma db push manually against the db WITHOUT the seed step."
