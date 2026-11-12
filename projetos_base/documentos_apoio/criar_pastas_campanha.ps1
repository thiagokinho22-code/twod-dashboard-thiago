# Script para criação automática de pastas de campanhas TWOD
# Uso: powershell -ExecutionPolicy Bypass -File .\criar_pastas_campanha.ps1 -NomeCampanha "Bingo 15.10.26"

param(
    [Parameter(Mandatory=$false)]
    [string]$NomeCampanha = "Bingo 15.10.26",

    [Parameter(Mandatory=$false)]
    [string]$BaseDir = ""
)

if (-not $BaseDir) {
    $found = Get-ChildItem -Path "C:\Users\thiag\OneDrive\Documentos\Trabalho" -Filter "*deos*" -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -match "V.+deos$" }
    if ($found) {
        $BaseDir = $found.FullName
    } else {
        $BaseDir = "C:\Users\thiag\OneDrive\Documentos\Trabalho\Vídeos"
    }
}

if (-not (Test-Path $BaseDir)) {
    Write-Host "[!] Diretorio base nao encontrado: $BaseDir" -ForegroundColor Red
    exit 1
}

$campaignDir = Join-Path $BaseDir $NomeCampanha
$blocos = @("Bloco A", "Bloco B")
$subpastas = @("1. Imagens", "Português", "Espanhol", "Inglês")

Write-Host "Criando estrutura de pastas para: $NomeCampanha..." -ForegroundColor Cyan

foreach ($bloco in $blocos) {
    foreach ($sub in $subpastas) {
        $folderPath = Join-Path (Join-Path $campaignDir $bloco) $sub
        if (-not (Test-Path $folderPath)) {
            New-Item -ItemType Directory -Path $folderPath -Force | Out-Null
            Write-Host " [+] Criada: $folderPath" -ForegroundColor Green
        } else {
            Write-Host " [=] Já existe: $folderPath" -ForegroundColor Yellow
        }
    }
}

Write-Host "[OK] Estrutura completa pronta em: $campaignDir" -ForegroundColor Green
