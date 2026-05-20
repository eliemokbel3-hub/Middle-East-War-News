$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$node = Get-Command node -ErrorAction SilentlyContinue
$port = if ($env:PORT) { $env:PORT } else { "3000" }

Write-Host ""
Write-Host "Middle East War News Brief" -ForegroundColor Cyan
Write-Host "Project: $root"
Write-Host ""

if (-not $node) {
  Write-Host "Node.js is not installed or is not on PATH." -ForegroundColor Yellow
  Write-Host "Install the LTS version from https://nodejs.org/, then run this launcher again."
  Write-Host ""
  Read-Host "Press Enter to close"
  exit 1
}

$localUrl = "http://localhost:$port"
$networkAddresses = @()

try {
  $networkAddresses = Get-NetIPAddress -AddressFamily IPv4 |
    Where-Object {
      $_.IPAddress -ne "127.0.0.1" -and
      $_.IPAddress -notlike "169.254.*" -and
      $_.PrefixOrigin -ne "WellKnown"
    } |
    Select-Object -ExpandProperty IPAddress -Unique
} catch {
  $networkAddresses = @()
}

Write-Host "PC URL:" -ForegroundColor Green
Write-Host "  $localUrl"
Write-Host ""

if ($networkAddresses.Count -gt 0) {
  Write-Host "Phone URL candidates, while your phone is on the same Wi-Fi:" -ForegroundColor Green
  foreach ($address in $networkAddresses) {
    Write-Host "  http://$address`:$port"
  }
} else {
  Write-Host "Phone URL: run ipconfig and use your Wi-Fi IPv4 address with port $port." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Leave this window open while using the dashboard."
Write-Host "Press Ctrl+C to stop it."
Write-Host ""

Start-Process $localUrl
& node server.js

Write-Host ""
Read-Host "Server stopped. Press Enter to close"
