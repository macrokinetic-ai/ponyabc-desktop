<#
.SYNOPSIS
  Installs the PonyABC Desktop Microsoft Store test package (.appx) for sideload testing.

.DESCRIPTION
  Run this ONCE, as Administrator, from the folder containing this script and the three files
  it expects to find next to it:
    - PonyABC-Desktop-v0.3.15-winx64.appx
    - PonyABC-Desktop-v0.3.15-winx64.appx.sha256
    - PonyABC-Desktop-test-cert.cer

  What it does, in order, and why:
    1. Verifies the .appx's SHA-256 checksum against the .sha256 file.
    2. Reads the exact certificate thumbprint out of the .cer file (never assumed).
    3. Checks whether a certificate with that EXACT thumbprint is already trusted in
       Cert:\LocalMachine\TrustedPeople. If yes, it is left alone and recorded as
       "already trusted" — this script will not later remove a certificate it did not add.
    4. Only if that exact thumbprint is not already present, imports the .cer there.
    5. Installs the package with Add-AppxPackage.
    6. Verifies the real, Windows-computed PackageFamilyName matches the expected value —
       the same check the automated build already passed, repeated here on your machine.
    7. Writes test-kit-state.json next to this script, recording exactly what was done, so
       3-cleanup.ps1 can undo only what THIS install actually changed.

  Does not touch UAC, SmartScreen, Windows Defender, or any other security setting — only the
  certificate trust store and this one app package.
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
Set-Location $scriptDir

# Discovered by pattern, not a hardcoded version number, so this script keeps working unchanged
# across future version bumps — the exact filename is whatever this download actually contains.
$appxFile = Get-ChildItem -Path $scriptDir -Filter '*.appx' | Select-Object -First 1
$cerName = 'PonyABC-Desktop-test-cert.cer'
$expectedPublisher = 'CN=E476FCF5-1C63-4A56-85B1-DA5D642911B5'
$expectedFamilyName = 'PonyABC.PonyABCDesktop_f1jemggxjsyxg'
$stateFile = Join-Path $scriptDir 'test-kit-state.json'

if (-not $appxFile) {
  Write-Host "No .appx file found in this folder." -ForegroundColor Red
  Write-Host "Make sure all files from the windows-appx.zip download are extracted into this same folder." -ForegroundColor Red
  exit 1
}
$appxName = $appxFile.Name
$shaName = "$appxName.sha256"

foreach ($f in @($shaName, $cerName)) {
  if (-not (Test-Path (Join-Path $scriptDir $f))) {
    Write-Host "Missing required file: $f" -ForegroundColor Red
    Write-Host "Make sure all files from the windows-appx.zip download are extracted into this same folder." -ForegroundColor Red
    exit 1
  }
}

Write-Host "=== 1. Verifying package checksum ===" -ForegroundColor Cyan
$expectedHashLine = (Get-Content $shaName -Raw).Trim()
$expectedHash = ($expectedHashLine -split '\s+')[0].ToLower()
$actualHash = (Get-FileHash -Path $appxName -Algorithm SHA256).Hash.ToLower()
if ($actualHash -ne $expectedHash) {
  Write-Host "CHECKSUM MISMATCH." -ForegroundColor Red
  Write-Host "  expected: $expectedHash"
  Write-Host "  actual:   $actualHash"
  Write-Host "Do not proceed. Re-download the file." -ForegroundColor Red
  exit 1
}
Write-Host "Checksum OK: $actualHash"

Write-Host ""
Write-Host "=== 2. Reading certificate thumbprint ===" -ForegroundColor Cyan
$certToImport = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2((Resolve-Path $cerName).Path)
$thumbprint = $certToImport.Thumbprint
$certSubject = $certToImport.Subject
Write-Host "Certificate file:   $cerName"
Write-Host "Subject:            $certSubject"
Write-Host "Thumbprint:         $thumbprint"
if ($certSubject -ne $expectedPublisher) {
  Write-Host "WARNING: certificate Subject does not match the expected Partner Center publisher ($expectedPublisher). Proceeding anyway, but this is unexpected — double-check you downloaded the right files." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "=== 3. Checking existing trust ===" -ForegroundColor Cyan
$existing = Get-ChildItem 'Cert:\LocalMachine\TrustedPeople' | Where-Object { $_.Thumbprint -eq $thumbprint }
$importedByUs = $false
if ($existing) {
  Write-Host "A certificate with this EXACT thumbprint is already trusted — leaving it as-is." -ForegroundColor Yellow
  Write-Host "(This script will NOT remove it during cleanup, since it did not add it.)" -ForegroundColor Yellow
} else {
  Write-Host "Not yet trusted. Importing..."
  Import-Certificate -FilePath (Resolve-Path $cerName).Path -CertStoreLocation 'Cert:\LocalMachine\TrustedPeople' | Out-Null
  $importedByUs = $true
  Write-Host "Imported and trusted (Cert:\LocalMachine\TrustedPeople)."
}

Write-Host ""
Write-Host "=== 4. Installing the package ===" -ForegroundColor Cyan
Add-AppxPackage -Path (Resolve-Path $appxName).Path
$installed = Get-AppxPackage -Name 'PonyABC.PonyABCDesktop'
if (-not $installed) {
  Write-Host "INSTALL FAILED — Add-AppxPackage did not error, but Get-AppxPackage found nothing." -ForegroundColor Red
  exit 1
}
Write-Host "Installed: $($installed.PackageFullName)"

Write-Host ""
Write-Host "=== 5. Verifying identity ===" -ForegroundColor Cyan
Write-Host "Real, Windows-computed PackageFamilyName: $($installed.PackageFamilyName)"
if ($installed.PackageFamilyName -ne $expectedFamilyName) {
  Write-Host "IDENTITY MISMATCH — expected '$expectedFamilyName'. Something is wrong; do not proceed with testing." -ForegroundColor Red
  exit 1
}
Write-Host "Identity confirmed — matches the Partner Center-registered value exactly." -ForegroundColor Green

$state = @{
  installedAtUtc     = (Get-Date).ToUniversalTime().ToString('o')
  appxFile           = $appxName
  certFile           = $cerName
  certThumbprint     = $thumbprint
  certImportedByUs   = $importedByUs
  packageFamilyName  = $installed.PackageFamilyName
  packageFullName    = $installed.PackageFullName
}
$state | ConvertTo-Json | Set-Content -Path $stateFile -Encoding UTF8
Write-Host ""
Write-Host "State recorded to test-kit-state.json (used by 3-cleanup.ps1 later)." -ForegroundColor Cyan

Write-Host ""
Write-Host "=== DONE ===" -ForegroundColor Green
Write-Host "You can now launch 'PonyABC Desktop' from the Start menu to try the app normally."
Write-Host "For the firmware/UAC probe test, use 2-run-firmware-probe.ps1 instead — from a NORMAL (non-administrator) PowerShell window, not this one."
