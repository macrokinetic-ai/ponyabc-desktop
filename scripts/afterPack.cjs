// electron-builder afterPack hook — must stay CommonJS (.cjs) regardless of this project's
// package.json "type": "module", the same way src/preload is forced to build as CJS: the
// hook is loaded via require(), not import.
//
// electron-builder's own mac code signing is disabled today (mac.identity: null in
// electron-builder.yml — no paid Apple Developer ID certificate exists yet), and with
// identity: null its "afterSign" hook never runs at all (electron-builder skips it and logs
// "no signing occurred, perhaps you intended afterPack?" — confirmed by reading
// node_modules/app-builder-lib/out/platformPackager.js directly). afterPack always runs
// regardless, so it's used here to apply a real ad-hoc signature ourselves.
//
// This does NOT make the app trusted (no Developer ID, no notarization — Gatekeeper will
// still warn on a downloaded copy) — it only ensures the .app that ships in the DMG carries
// a genuine, verifiable signature instead of relying on macOS's implicit sign-at-first-local-
// launch, which never gets baked into the file placed in the DMG.
const { execFileSync } = require('node:child_process');
const path = require('node:path');

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], { stdio: 'inherit' });
};
