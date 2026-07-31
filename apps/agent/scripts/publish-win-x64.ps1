# Publish self-contained single-file Windows agent (no .NET runtime required on client).
# Usage:
#   powershell -ExecutionPolicy Bypass -File apps/agent/scripts/publish-win-x64.ps1
#   powershell -ExecutionPolicy Bypass -File apps/agent/scripts/publish-win-x64.ps1 -ApiBaseUrl https://api.example.com

param(
    [string]$Configuration = "Release",
    [string]$OutputDir = "",
    [string]$ApiBaseUrl = "http://localhost:3001"
)

$ErrorActionPreference = "Stop"
$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$proj = Join-Path $root "src/Einvoice.Agent.Desktop/Einvoice.Agent.Desktop.csproj"
if (-not $OutputDir) {
    $OutputDir = Join-Path $root "dist/win-x64"
}

Write-Host "Publishing Einvoice.Agent -> $OutputDir"
dotnet publish $proj `
    -c $Configuration `
    -r win-x64 `
    --self-contained true `
    -p:PublishSingleFile=true `
    -p:IncludeNativeLibrariesForSelfExtract=true `
    -p:EnableCompressionInSingleFile=true `
    -o $OutputDir

if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$built = Join-Path $OutputDir "Einvoice.Agent.Desktop.exe"
$exe = Join-Path $OutputDir "Einvoice.Agent.exe"
if (-not (Test-Path $built)) {
    throw "Expected EXE not found: $built"
}
Copy-Item -Force $built $exe
# Keep Desktop name too for debugging; ship Einvoice.Agent.exe to clients.

# Companion launcher for local testing (sets API URL; PKCS#11 auto-detects when DLL present).
$cmd = @"
@echo off
REM Local test launcher — edit EINVOICE_API_BASE_URL for your environment.
set EINVOICE_API_BASE_URL=$ApiBaseUrl
set SIGNING_PROVIDER=pkcs11
start "" "%~dp0Einvoice.Agent.exe"
"@
Set-Content -Path (Join-Path $OutputDir "Run-Agent.cmd") -Value $cmd -Encoding ASCII

$sizeMb = [math]::Round((Get-Item $exe).Length / 1MB, 2)
Write-Host ""
Write-Host "OK: $exe ($sizeMb MB)"
Write-Host "Also built: $built"
Write-Host "Optional launcher: $(Join-Path $OutputDir 'Run-Agent.cmd')"
Write-Host "Send the client: Einvoice.Agent.exe (and optionally Run-Agent.cmd)."
Write-Host "Client needs: USB eSeal token + CA PKCS#11 middleware (e.g. eps2003csp11.dll)."
