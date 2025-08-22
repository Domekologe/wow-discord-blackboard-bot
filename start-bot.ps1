# Windows starter (optional)
param([switch]$NoRegister)
$ErrorActionPreference = "Stop"
Set-Location (Split-Path -Parent $MyInvocation.MyCommand.Definition)

if (Test-Path ".env.dev.example") { Copy-Item ".env.dev.example" ".env" -Force }
if (!(Test-Path "node_modules")) { npm install }

if (-not $NoRegister) { npm run register }
npm run dev
