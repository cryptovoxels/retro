$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")

$env:NODE_TLS_REJECT_UNAUTHORIZED = "0"
$env:NODE_ENV = "development"

Write-Host "Starting scratchpad dev (server :9000, client webpack :9100)..."
npx concurrently -k `
  "npm run watch-css" `
  "npm run server:dev" `
  "npm run webpack:client:start"
