<#
  push-chatbot.ps1 — push ONLY the AI-chatbot changed/new files to the sandbox
  server, preserving folder layout (new folders are created automatically).

  Run from anywhere:
      powershell -ExecutionPolicy Bypass -File deploy\push-chatbot.ps1

  You'll be asked for vlkt's password TWICE: once for the upload (scp), once for
  the extract (ssh). Nothing is built here — afterwards, rebuild on the box:
      docker compose -f docker-compose.sandbox.yml up -d --build

  Needs: Windows 10/11 (has tar + ssh + scp built in).
#>

$ErrorActionPreference = 'Stop'

# --- server settings (edit here if they ever change) ---
$HostIP    = '103.88.122.23'
$Port      = '63379'
$User      = 'vlkt'
$RemoteDir = '~/hcmus-cms'

# --- the exact chatbot paths, relative to the repo root ---
$Files = @(
  'docker-compose.yml',
  'docker-compose.sandbox.yml',
  'pnpm-lock.yaml',
  'backend/package.json',
  'backend/src/app.module.ts',
  'backend/src/post/post.module.ts',
  'backend/src/post/post.service.ts',
  'backend/src/chatbot',                                 # new folder (7 files)
  'backend/prisma/migrations/20260717_chatbot_vectors',  # new folder (migration.sql)
  'frontend-public/src/app/layout.tsx',
  'frontend-public/src/lib/api.ts',
  'frontend-public/src/components/ChatWidget.tsx'         # new file
)

# this script lives in deploy/, so the repo root is its parent
$RepoRoot = Split-Path $PSScriptRoot -Parent
Set-Location $RepoRoot
Write-Host "Repo root: $RepoRoot" -ForegroundColor DarkGray

# fail early if anything is missing
$missing = $Files | Where-Object { -not (Test-Path $_) }
if ($missing) { throw "These paths don't exist:`n  $($missing -join "`n  ")" }

$Bundle = 'chatbot-bundle.tgz'
Write-Host "Bundling $($Files.Count) paths -> $Bundle ..." -ForegroundColor Cyan
tar -czf $Bundle $Files
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
  Remove-Item $Bundle -ErrorAction SilentlyContinue   # tidy up the local archive
}

Write-Host "`nDone. Files are on the server. Next, deploy on the box:" -ForegroundColor Green
Write-Host "  ssh -p $Port ${User}@${HostIP}"
Write-Host "  cd $RemoteDir"
Write-Host "  docker compose -f docker-compose.sandbox.yml up -d --build"
Write-Host "  # then apply migration.sql, pull the model, and reindex (see deploy steps)"
