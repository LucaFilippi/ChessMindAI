$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
function Check-Exit { if ($LASTEXITCODE -ne 0) { throw "Comando falhou (codigo $LASTEXITCODE)." } }
if (-not (Test-Path '.venv/Scripts/python.exe')) {
    py -3.11 -m venv .venv
    Check-Exit
}
& '.venv/Scripts/python.exe' -m pip install -r requirements.txt
Check-Exit
Push-Location frontend
try {
    npm ci
    Check-Exit
    npm run build
    Check-Exit
} finally { Pop-Location }
Write-Host 'Instalacao concluida. Execute Start.ps1 e abra http://127.0.0.1:8000' -ForegroundColor Green
