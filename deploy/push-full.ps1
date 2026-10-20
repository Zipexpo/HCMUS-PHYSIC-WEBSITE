<#
  push-full.ps1 — push the FULL backend + public source to the sandbox server,
  so the server codebase is consistent (fixes partial-bundle build breaks like
  missing tag/notification modules or a stale schema.prisma).

  Run from anywhere:
      powershell -ExecutionPolicy Bypass -File deploy\push-full.ps1

  Asks for vlkt's password TWICE (scp upload, then ssh extract).
  Does NOT touch backend/.env or backend/uploads on the server (not in the bundle).
  Nothing is built here — rebuild on the box afterwards:
      docker compose -f docker-compose.sandbox.yml build --no-cache backend
      docker compose -f docker-compose.sandbox.yml up -d --no-deps backend
#>

$ErrorActionPreference = 'Stop'

# --- server settings ---
$HostIP    = '103.88.122.23'
$Port      = '63379'
$User      = 'vlkt'
$RemoteDir = '~/hcmus-cms'

# --- full source needed for a consistent build (dirs are recursive) ---
$Files = @(
  'docker-compose.yml',
  'docker-compose.sandbox.yml',
  'package.json',
  'pnpm-workspace.yaml',
  'pnpm-lock.yaml',
  'backend/package.json',
  'backend/nest-cli.json',
  'backend/tsconfig.json',
  'backend/tsconfig.build.json',
  'backend/prisma.config.ts',
  'backend/Dockerfile',
  'backend/src',
  'backend/prisma',
  'backend/initialScript',
  'frontend/package.json',
  'frontend/Dockerfile',
  'frontend/src',
  # public/ holds static assets served straight off the origin (default-cover.png,
  # logos, self-hosted fonts). Leaving it out let the server keep a July copy, so
  # every news card without a cover 404'd on /default-cover.png and showed a broken
  # image. Static assets are part of "full source" — keep them in the bundle.
  'frontend/public',
  'frontend-public/package.json',
  'frontend-public/Dockerfile',
  'frontend-public/next.config.ts',
  'frontend-public/src',
  'frontend-public/public'
)

$RepoRoot = Split-Path $PSScriptRoot -Parent
Set-Location $RepoRoot
Write-Host "Repo root: $RepoRoot" -ForegroundColor DarkGray

$missing = $Files | Where-Object { -not (Test-Path $_) }
if ($missing) { throw "These paths don't exist:`n  $($missing -join "`n  ")" }

$Bundle = 'full-bundle.tgz'
Write-Host "Bundling $($Files.Count) paths -> $Bundle ..." -ForegroundColor Cyan
# Exclude the 69MB legacy SQL dump (and any node_modules) — never needed on the
# server and would bloat every push.
tar -czf $Bundle --exclude='backend/initialScript/migrate-legacy/dump' --exclude='node_modules' $Files
if ($LASTEXITCODE -ne 0) { throw 'tar failed' }

try {
  Write-Host "`n[1/2] Uploading to ${User}@${HostIP}:${RemoteDir}/  (enter password) ..." -ForegroundColor Cyan
  scp -P $Port $Bundle "${User}@${HostIP}:${RemoteDir}/"
  if ($LASTEXITCODE -ne 0) { throw 'scp upload failed' }

  Write-Host "`n[2/2] Extracting on the server  (enter password again) ..." -ForegroundColor Cyan
  ssh -p $Port "${User}@${HostIP}" "cd ${RemoteDir} && tar -xzf ${Bundle} && rm -f ${Bundle} && echo '--- extracted OK ---'"
  if ($LASTEXITCODE -ne 0) { throw 'ssh extract failed' }
}
finally {
  Remove-Item $Bundle -ErrorAction SilentlyContinue
}

Write-Host "`nDone. Full source is on the server. Rebuild on the box:" -ForegroundColor Green
Write-Host "  docker compose -f docker-compose.sandbox.yml build --no-cache backend"
Write-Host "  docker compose -f docker-compose.sandbox.yml up -d --no-deps backend"
