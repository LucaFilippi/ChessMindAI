$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
if (-not (Test-Path '.venv/Scripts/python.exe') -or -not (Test-Path 'frontend/dist/index.html')) {
    throw 'Execute Install.ps1 primeiro.'
}
Write-Host 'Chess Mind AI: http://127.0.0.1:8000  |  Ctrl+C para encerrar.' -ForegroundColor Green
& '.venv/Scripts/python.exe' -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
