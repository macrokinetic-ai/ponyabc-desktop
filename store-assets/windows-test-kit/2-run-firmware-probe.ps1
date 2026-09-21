<#
.SYNOPSIS
  Runs the harmless firmware-plumbing probe from a NORMAL (non-administrator) session, so the
  app's own internal UAC elevation request produces a real, visible consent prompt.

.DESCRIPTION
  IMPORTANT: run this from an ORDINARY PowerShell window — do NOT "Run as administrator".
  If this script itself is elevated, the app it launches inherits that elevation, and its
  internal UAC request will be silently auto-approved with no visible prompt at all — which
  would make this test meaningless. The script checks for this and refuses to continue if it
  detects it is running elevated.

  This never runs any real vendor firmware tool and never touches a real pen. It launches the
  installed PonyABC Desktop app with two environment variables that make it run a two-line,
  harmless stand-in script (just prints a marker and exits) through the exact same elevation
  mechanism the real firmware wizard uses, then quits automatically.

.PARAMETER DelaySeconds
  Optional (0-60). Makes the harmless stand-in script pause for this many seconds before
  finishing, AFTER you approve the UAC prompt. Use this only for the "interrupted mid-flight"
  recovery test in the README — it gives you a real window of time to force-close the app while
  the elevated process is still genuinely running. Leave at 0 for a normal approve/cancel test.
#>

param(
  [ValidateRange(0, 60)]
  [int]$DelaySeconds = 0
)

$ErrorActionPreference = 'Stop'

function Test-IsElevated {
  return ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

if (Test-IsElevated) {
  Write-Host ""
  Write-Host "STOP: this PowerShell window is running as Administrator." -ForegroundColor Red
  Write-Host "Running this script elevated would make the app launch already-elevated too, so its own UAC request would be silently auto-approved with no real prompt to test." -ForegroundColor Red
  Write-Host "Close this window and open an ORDINARY PowerShell window instead (Start menu -> type PowerShell -> press Enter, not 'Run as administrator'), then run this script again from there." -ForegroundColor Red
  exit 1
}

$installed = Get-AppxPackage -Name 'PonyABC.PonyABCDesktop'
if (-not $installed) {
  Write-Host "PonyABC Desktop is not installed. Run 1-install.ps1 first (as Administrator)." -ForegroundColor Red
  exit 1
}

# Resolve the real executable from the installed manifest, not a directory listing — WindowsApps'
# ACLs block a plain listing even for an admin, and this is the same source of truth Windows
# itself uses to launch the app.
[xml]$installedManifest = Get-Content -Path (Join-Path $installed.InstallLocation 'AppxManifest.xml') -Raw
$ns = New-Object System.Xml.XmlNamespaceManager($installedManifest.NameTable)
$ns.AddNamespace('a', 'http://schemas.microsoft.com/appx/manifest/foundation/windows10')
$exeRelPath = $installedManifest.SelectSingleNode('//a:Application', $ns).GetAttribute('Executable')
$exePath = Join-Path $installed.InstallLocation $exeRelPath
if (-not (Test-Path -LiteralPath $exePath -PathType Leaf)) {
  Write-Host "Could not find the app executable at the path the manifest names ('$exePath')." -ForegroundColor Red
  exit 1
}

$probeOutput = Join-Path $env:TEMP 'ponyabc-msix-probe-result.json'
Remove-Item $probeOutput -ErrorAction SilentlyContinue

Write-Host "Running from a normal (non-administrator) session: confirmed." -ForegroundColor Green
Write-Host "App executable resolved from the installed manifest: $exePath"
if ($DelaySeconds -gt 0) {
  Write-Host "Delay requested: the harmless stand-in script will pause for $DelaySeconds second(s) after you approve — use this window to test an interrupted launch if that's what you're doing right now." -ForegroundColor Yellow
}
Write-Host ""
Write-Host "Launching now. WATCH FOR A REAL WINDOWS PROMPT asking to allow this app to make changes to your device." -ForegroundColor Cyan
Write-Host "Click Yes to test approval, or No to test cancellation — either is a valid, useful result." -ForegroundColor Cyan
Write-Host ""

$proc = $null
try {
  $env:PONYABC_MSIX_FIRMWARE_PROBE = '1'
  $env:PONYABC_MSIX_FIRMWARE_PROBE_OUTPUT = $probeOutput
  if ($DelaySeconds -gt 0) { $env:PONYABC_MSIX_PROBE_DELAY_SECONDS = "$DelaySeconds" }

  $proc = Start-Process -FilePath $exePath -PassThru

  # Confirm the LAUNCHED process itself carries real package identity — not just that it's
  # installed under WindowsApps. Uses the documented Win32 GetPackageFullName API: it succeeds
  # (returns 0) only for a process with package identity, and fails with APPMODEL_ERROR_NO_PACKAGE
  # (15700) for an ordinary unpackaged process.
  Start-Sleep -Milliseconds 500 # give the process a moment to fully initialize before querying it
  $packageFullName = $null
  $identityCheckError = $null
  try {
    Add-Type -Namespace PonyAbcWin32 -Name AppModel -MemberDefinition @"
[System.Runtime.InteropServices.DllImport("kernel32.dll")]
public static extern int GetPackageFullName(System.IntPtr hProcess, ref int packageFullNameLength, System.Text.StringBuilder packageFullName);
"@ -ErrorAction SilentlyContinue

    $liveProc = Get-Process -Id $proc.Id -ErrorAction Stop
    $len = 0
    [PonyAbcWin32.AppModel]::GetPackageFullName($liveProc.Handle, [ref]$len, $null) | Out-Null
    if ($len -gt 0) {
      $sb = New-Object System.Text.StringBuilder $len
      $rc = [PonyAbcWin32.AppModel]::GetPackageFullName($liveProc.Handle, [ref]$len, $sb)
      if ($rc -eq 0) { $packageFullName = $sb.ToString() }
    }
  } catch {
    $identityCheckError = $_.Exception.Message
  }

  if ($packageFullName) {
    Write-Host "Package identity CONFIRMED for the running process: $packageFullName" -ForegroundColor Green
  } else {
    Write-Host "Could not confirm package identity for the running process (it may have already exited, or the check itself failed: $identityCheckError)." -ForegroundColor Yellow
  }

  Write-Host ""
  Write-Host "Waiting for the app to finish the probe and quit on its own (up to 10 minutes — take your time with the prompt)..." -ForegroundColor Cyan
  $exited = $proc.WaitForExit(600000)
  if (-not $exited) {
    Write-Host "The app did not exit within 10 minutes. If you're done testing, you can close it manually." -ForegroundColor Yellow
  } else {
    Write-Host "App exited on its own."
  }
} finally {
  # Guaranteed even if something above throws — these must never leak into your normal shell.
  Remove-Item Env:\PONYABC_MSIX_FIRMWARE_PROBE -ErrorAction SilentlyContinue
  Remove-Item Env:\PONYABC_MSIX_FIRMWARE_PROBE_OUTPUT -ErrorAction SilentlyContinue
  Remove-Item Env:\PONYABC_MSIX_PROBE_DELAY_SECONDS -ErrorAction SilentlyContinue
}

Write-Host ""
Write-Host "=== Result ===" -ForegroundColor Cyan
if (Test-Path $probeOutput) {
  $resultJson = Get-Content $probeOutput -Raw
  $resultObj = $resultJson | ConvertFrom-Json
  Write-Host ("Elevation status: {0}" -f $resultObj.elevation.status)
  Write-Host ("Log captured correctly: {0}" -f $resultObj.logContainsExpectedMarker)
  Write-Host ("Recovery marker round trip: {0}" -f $resultObj.recoveryMarkerReadBackImmediately)
  Write-Host ""
  Write-Host "Full technical result:"
  Write-Host $resultJson
} else {
  Write-Host "No result file was produced." -ForegroundColor Yellow
  Write-Host "This is EXPECTED if you clicked 'No' on the UAC prompt, or if you force-closed the app before it finished (e.g. for the interrupted-launch test) — in either case, check the README's 'What to expect next' section rather than treating this as a failure by itself."
}

Write-Host ""
Write-Host "Next: if you just did the interrupted-launch test, relaunch the app NORMALLY (double-click from the Start menu, not this script) and go to the Firmware section to check its recovery behavior — see the README, 'Interrupted-launch / recovery test' section, before deciding whether this is correct or not."
