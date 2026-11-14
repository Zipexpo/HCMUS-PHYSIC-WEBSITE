<#
  push-ticket.ps1 — gửi mã nguồn HỆ PHIẾU HỖ TRỢ (ticket/) + docker-compose.sandbox.yml
  lên máy chủ. Không đụng backend / admin / public.

  Chạy:
      powershell -ExecutionPolicy Bypass -File deploy\push-ticket.ps1

  Hỏi mật khẩu vlkt HAI lần (scp, rồi ssh giải nén).
  Không build gì ở đây — xem các lệnh in ra ở cuối.
#>

$ErrorActionPreference = 'Stop'

$HostIP    = '103.88.122.23'
$Port      = '63379'
$User      = 'vlkt'
$RemoteDir = '~/hcmus-cms'

$Files = @('ticket', 'docker-compose.sandbox.yml')

$RepoRoot = Split-Path $PSScriptRoot -Parent
Set-Location $RepoRoot

$missing = $Files | Where-Object { -not (Test-Path $_) }
if ($missing) { throw "Thiếu: $($missing -join ', ')" }

$Bundle = 'ticket-bundle.tgz'
Write-Host "Đóng gói $($Files -join ', ') -> $Bundle ..." -ForegroundColor Cyan
# Bỏ thư mục sinh ra lúc build/cài: server tự build trong Docker.
tar -czf $Bundle --exclude='node_modules' --exclude='ticket/.next' --exclude='ticket/src/generated' --exclude='ticket/.env*' $Files
if ($LASTEXITCODE -ne 0) { throw 'tar lỗi' }

try {
  Write-Host "`n[1/2] Tải lên ${User}@${HostIP}  (nhập mật khẩu) ..." -ForegroundColor Cyan
  scp -P $Port $Bundle "${User}@${HostIP}:${RemoteDir}/"
  if ($LASTEXITCODE -ne 0) { throw 'scp lỗi' }

  Write-Host "`n[2/2] Giải nén trên máy chủ  (nhập mật khẩu lần nữa) ..." -ForegroundColor Cyan
  # sed bỏ CRLF của Windows trong file compose cho gọn diff về sau.
  ssh -p $Port "${User}@${HostIP}" "cd ${RemoteDir} && tar -xzf ${Bundle} && rm -f ${Bundle} && sed -i 's/\r$//' docker-compose.sandbox.yml && echo '--- giai nen OK ---'"
  if ($LASTEXITCODE -ne 0) { throw 'ssh lỗi' }
}
finally {
  Remove-Item $Bundle -ErrorAction SilentlyContinue
}

Write-Host "`nXong. Trên máy chủ chạy tiếp:" -ForegroundColor Green
Write-Host "  docker exec -i hcmus-cms-db-1 psql -U physics -d hcmus_ticket -v ON_ERROR_STOP=1 -f - < ticket/prisma/migrate-002.sql"
Write-Host "  docker compose -f docker-compose.sandbox.yml build ticket"
Write-Host "  docker compose -f docker-compose.sandbox.yml up -d --no-deps ticket"
