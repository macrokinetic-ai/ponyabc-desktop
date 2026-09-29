<#
.SYNOPSIS
  Removes ONLY what this test kit's install script added: the test package, and — only if
  1-install.ps1 actually imported it — the specific certificate thumbprint it imported.

.DESCRIPTION
  Run this as Administrator when you're done testing. It reads test-kit-state.json (written by
  1-install.ps1) to know exactly what was changed on this machine, so it never removes a
  certificate that was already trusted before you ran this kit, and never touches any other
  certificate that happens to share the same Subject but has a different thumbprint.

  Does not change any Windows security setting (UAC, SmartScreen, Defender) — those were never
  touched in the first place.
#>

$ErrorActionPreference = 'Stop'

function Assert-Admin {
  $isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
  if (-not $isAdmin) {
    Write-Host ""
    Write-Host "This script must be run as Administrator." -ForegroundColor Red
    Write-Host "Right-click PowerShell in the Start menu and choose 'Run as administrator', then run this script again from there." -ForegroundColor Red
    exit 1
  }
}

Assert-Admin

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$stateFile = Join-Path $scriptDir 'test-kit-state.json'

Write-Host "=== 1. Removing the test package ===" -ForegroundColor Cyan
$installed = Get-AppxPackage -Name 'PonyABC.PonyABCDesktop' -ErrorAction SilentlyContinue
if ($installed) {
  Remove-AppxPackage -Package $installed.PackageFullName
  Write-Host "Removed: $($installed.PackageFullName)"
} else {
  Write-Host "Not currently installed — nothing to remove."
}

Write-Host ""
Write-Host "=== 2. Removing the test certificate (only if this kit imported it) ===" -ForegroundColor Cyan
if (-not (Test-Path $stateFile)) {
  Write-Host "No test-kit-state.json found — cannot tell what was imported, so no certificate will be touched." -ForegroundColor Yellow
} else {
  $state = Get-Content $stateFile -Raw | ConvertFrom-Json
  if (-not $state.certImportedByUs) {
    Write-Host "This kit found the certificate (thumbprint $($state.certThumbprint)) ALREADY trusted and did not import it — leaving it exactly as it was." -ForegroundColor Yellow
  } else {
    $cert = Get-ChildItem 'Cert:\LocalMachine\TrustedPeople' | Where-Object { $_.Thumbprint -eq $state.certThumbprint }
    if ($cert) {
      Remove-Item -Path $cert.PSPath
      Write-Host "Removed certificate with thumbprint $($state.certThumbprint) from Cert:\LocalMachine\TrustedPeople."
    } else {
      Write-Host "The recorded certificate (thumbprint $($state.certThumbprint)) is no longer present — nothing to remove."
    }
  }
  Remove-Item $stateFile -ErrorAction SilentlyContinue
}

Write-Host ""
Write-Host "=== 3. Removing leftover probe result file, if any ===" -ForegroundColor Cyan
$probeOutput = Join-Path $env:TEMP 'ponyabc-msix-probe-result.json'
if (Test-Path $probeOutput) {
  Remove-Item $probeOutput -ErrorAction SilentlyContinue
  Write-Host "Removed $probeOutput"
} else {
  Write-Host "Nothing to remove."
}

Write-Host ""
Write-Host "=== DONE. No Windows security setting was changed by this kit at any point. ===" -ForegroundColor Green
# Explicit on purpose — see 1-install.ps1's matching comment: PowerShell cmdlets never set
# $LASTEXITCODE themselves, so a caller checking it would otherwise see a stale prior value.
exit 0
