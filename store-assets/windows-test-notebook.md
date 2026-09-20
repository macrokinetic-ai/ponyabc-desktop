# Windows interactive test notebook (for a real machine — not CI)

This is for the one thing CI genuinely cannot answer: whether the real, interactive Windows UAC
consent prompt fires correctly when the firmware wizard tries to elevate, from inside an
installed Microsoft Store (MSIX/appx) package. CI has no interactive desktop session to click
"Yes"/"No" on, so a real Windows machine (this notebook/laptop) is the only way to observe it.

**This only ever uses a harmless, local stand-in script — never a real vendor firmware tool, and
you do not need a P5 pen connected for this specific test.** It also never disables Windows
security features (UAC, Defender, SmartScreen) — it adds one narrowly-scoped, temporary test
certificate to your own user trust store, and removes it again at the end.

## What you'll need

- A Windows 10/11 machine with PowerShell (built in — no other install needed for this notebook).
- Administrator rights (needed to import a certificate and to install a sideloaded app package).

## 1. Get the package

Either:
- **Download the CI-built `.appx`** from the latest run of *Build Windows EXE + Store package* in
  the repo's Actions tab (artifact `windows-appx`) or from a tagged Release, **or**
- **Build it yourself** on this machine (see the repo README's "Windows builds" section —
  `npm run dist:win:appx`, which needs Node.js installed).

Either way, note the exact `.appx` file's path — the rest of this notebook calls it `$appxPath`.

```powershell
$appxPath = "C:\Users\<you>\Downloads\PonyABC-Desktop-v0.3.15-winx64.appx"   # adjust to your actual path
```

## 2. Create a temporary, narrowly-scoped test certificate

This certificate's ONLY purpose is letting Windows trust this one sideloaded test package. It is
not a real Store or code-signing certificate, never leaves this machine, and is deleted in step 5.

```powershell
# Run in an Administrator PowerShell window.
$certSubject = 'CN=E476FCF5-1C63-4A56-85B1-DA5D642911B5'   # must match exactly — this is the app's registered Partner Center publisher
$cert = New-SelfSignedCertificate -Type Custom -Subject $certSubject `
  -KeyUsage DigitalSignature -FriendlyName 'PonyABC Desktop notebook test cert (temporary)' `
  -CertStoreLocation 'Cert:\CurrentUser\My' `
  -TextExtension @('2.5.29.37={text}1.3.6.1.5.5.7.3.3', '2.5.29.19={text}')

$cerPath = "$env:TEMP\ponyabc-notebook-test-cert.cer"
Export-Certificate -Cert $cert -FilePath $cerPath | Out-Null
Import-Certificate -FilePath $cerPath -CertStoreLocation 'Cert:\LocalMachine\TrustedPeople' | Out-Null
```

**If you downloaded the CI-built `.appx` rather than building it yourself**, it was signed with a
*different* ephemeral certificate (CI generates a fresh one every run and never exports it) — the
one above won't match, and `Add-AppxPackage` will fail with a trust error. In that case, skip
straight to **building it yourself** in step 1 instead (so you control the signing certificate),
or ask for the CI run's `.cer` to be published as a companion artifact if you'd rather sideload
the exact CI-built file.

## 3. Install it

```powershell
Add-AppxPackage -Path $appxPath
```

If this succeeds, the app is now installed like any Store app (Start menu, `PonyABC Desktop`).

## 4. Run the harmless elevation/plumbing probe

This drives the exact same production code the real firmware wizard uses (elevation, working
directory, log reading, the crash-recovery marker file) against a two-line stand-in script — never
a real vendor tool, never touches a pen.

```powershell
$installed = Get-AppxPackage -Name 'PonyABC.PonyABCDesktop'
$exe = Get-ChildItem -Path $installed.InstallLocation -Filter '*.exe' | Select-Object -First 1

$probeOutput = "$env:TEMP\msix-firmware-probe-result.json"
if (Test-Path $probeOutput) { Remove-Item $probeOutput -Force }
$env:PONYABC_MSIX_FIRMWARE_PROBE = '1'
$env:PONYABC_MSIX_FIRMWARE_PROBE_OUTPUT = $probeOutput

Start-Process -FilePath $exe.FullName
```

**Watch for the real UAC "Do you want to allow this app to make changes to your device?" prompt.**
This is the actual thing CI cannot show you. Note what you see:
- A real UAC prompt appears → click **Yes**. This confirms the elevation mechanism works
  interactively from inside the packaged app.
- No prompt appears at all, or the app seems to hang → that's itself an important, real finding —
  note it plainly, don't assume either way.

Once the app process exits on its own (it quits automatically after the probe finishes), read the
result:

```powershell
Remove-Item Env:\PONYABC_MSIX_FIRMWARE_PROBE, Env:\PONYABC_MSIX_FIRMWARE_PROBE_OUTPUT -ErrorAction SilentlyContinue
Get-Content $probeOutput | ConvertFrom-Json | ConvertTo-Json -Depth 6
```

Please share that JSON output (or a screenshot of it) plus what you observed about the UAC prompt
— that's the concrete evidence this whole exercise exists to gather.

## 5. Optional: try the golden path in the UI

Launch the app normally (Start menu → PonyABC Desktop) and click through Home, BOOK Library, My
Recordings, and Settings → About — the About panel should read **"Windows · x64 (Microsoft
Store)"**, confirming the app correctly detects it's running as a Store package.

## 6. Clean up

```powershell
# Uninstall the sideloaded test package
$installed = Get-AppxPackage -Name 'PonyABC.PonyABCDesktop' -ErrorAction SilentlyContinue
if ($installed) { Remove-AppxPackage -Package $installed.PackageFullName }

# Remove the temporary test certificate (only from step 2, if you ran it)
Get-ChildItem 'Cert:\LocalMachine\TrustedPeople' | Where-Object { $_.Subject -eq 'CN=E476FCF5-1C63-4A56-85B1-DA5D642911B5' } | Remove-Item
Get-ChildItem 'Cert:\CurrentUser\My' | Where-Object { $_.Subject -eq 'CN=E476FCF5-1C63-4A56-85B1-DA5D642911B5' } | Remove-Item
Remove-Item "$env:TEMP\ponyabc-notebook-test-cert.cer", "$env:TEMP\msix-firmware-probe-result.json" -ErrorAction SilentlyContinue
```

Nothing about Windows' own security settings (UAC level, SmartScreen, Defender) needs to change
for any of this, and none of the steps above touch them — only your own user certificate store
and this one sideloaded app.
