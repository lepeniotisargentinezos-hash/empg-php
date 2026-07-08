param(
    [string]$OutDir = ''
)

# Gera pasta empa-deploy/ (+ zip opcional) para upload via FileZilla.
# Preserva data/, .env e configs do servidor.
# Uso:  .\scripts\build-deploy-package.ps1

$ErrorActionPreference = 'Stop'

$Root = Split-Path -Parent $PSScriptRoot
$ExcludeFile = Join-Path $Root 'deploy-exclude.txt'
if ($OutDir -eq '') {
    $OutDir = Join-Path $Root 'empa-deploy'
} else {
    if (-not [System.IO.Path]::IsPathRooted($OutDir)) {
        $OutDir = Join-Path $Root $OutDir
    }
}
$OutDir = [System.IO.Path]::GetFullPath($OutDir)
$Root = [System.IO.Path]::GetFullPath($Root)
$OutZip = $OutDir + '.zip'

function Test-ExcludedPath {
    param(
        [string]$RelativePath,
        [string[]]$Patterns
    )

    $rel = $RelativePath -replace '\\', '/'
    foreach ($pattern in $Patterns) {
        if ($pattern -eq '') { continue }

        if ($pattern.EndsWith('*/')) {
            $prefix = $pattern.TrimEnd('*/')
            if ($rel -eq $prefix -or $rel.StartsWith($prefix)) {
                return $true
            }
            continue
        }

        if ($pattern.EndsWith('/')) {
            $prefix = $pattern.TrimEnd('/')
            if ($rel -eq $prefix -or $rel.StartsWith($prefix + '/')) {
                return $true
            }
            continue
        }

        if ($rel -eq $pattern) {
            return $true
        }

        if ($rel.EndsWith('/' + $pattern)) {
            return $true
        }
    }

    return $false
}

Write-Host 'CredPix — pacote de deploy (preserva dados no servidor)' -ForegroundColor Cyan
Write-Host "Origem: $Root"

if (-not (Test-Path $ExcludeFile)) {
    throw "Arquivo nao encontrado: $ExcludeFile"
}

$patterns = Get-Content $ExcludeFile |
    ForEach-Object { $_.Trim() } |
    Where-Object { $_ -and -not $_.StartsWith('#') }

$outRel = $OutDir.Substring($Root.Length).TrimStart('\', '/').Replace('\', '/')
if ($outRel -ne '') {
    $patterns += $outRel
    $patterns += $outRel + '/'
}

if (Test-Path $OutDir) {
    try {
        Remove-Item $OutDir -Recurse -Force -ErrorAction Stop
    } catch {
        Write-Host "AVISO: nao foi possivel apagar $OutDir (arquivo em uso). Copiando por cima..." -ForegroundColor Yellow
    }
}
if (-not (Test-Path $OutDir)) {
    New-Item -ItemType Directory -Path $OutDir | Out-Null
}

$skipped = 0
$copied = 0

Get-ChildItem -Path $Root -Recurse -Force -File | ForEach-Object {
    $rel = $_.FullName.Substring($Root.Length).TrimStart('\', '/')
    if (Test-ExcludedPath $rel $patterns) {
        $skipped++
        return
    }

    $dest = Join-Path $OutDir $rel
    $destDir = Split-Path $dest -Parent
    if (-not (Test-Path $destDir)) {
        New-Item -ItemType Directory -Path $destDir -Force | Out-Null
    }
    Copy-Item $_.FullName $dest -Force
    $copied++
}

if (Test-Path $OutZip) {
    Remove-Item $OutZip -Force
}

Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Compression.ZipFile]::CreateFromDirectory($OutDir, $OutZip)

Write-Host ''
Write-Host "Arquivos incluidos : $copied" -ForegroundColor Green
Write-Host "Arquivos ignorados : $skipped" -ForegroundColor Yellow
Write-Host "Pasta para FileZilla: $OutDir" -ForegroundColor Green
Write-Host "Zip (opcional)     : $OutZip" -ForegroundColor Green
Write-Host ''
Write-Host 'FileZilla:' -ForegroundColor Cyan
Write-Host '  Local  (esquerda) : abra a pasta empa-deploy'
Write-Host '  Remoto (direita)  : public_html/empa  (ou sua pasta do site)'
Write-Host '  Selecione tudo em empa-deploy e arraste para empa no servidor'
Write-Host '  Nao apague data/ nem .env no servidor antes'
Write-Host ''
