# Build alternativo quando empa-deploy/ está bloqueado pelo Windows/Cursor.
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$OutDir = Join-Path $Root 'empa-deploy-full'
& (Join-Path $PSScriptRoot 'build-deploy-package.ps1') -OutDir $OutDir
