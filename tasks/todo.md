# v0.2.5 — fix cross-platform testing blockers

Mirrors `/Users/aiagent/.claude/plans/cryptic-coalescing-cookie.md`.

- [x] 1. Fix `isPathContained` in `pathSecurity.ts` (path.relative-based, rel==='' → true); replace 2 call sites
- [x] 2. `tests/unit/pathContainment.test.ts` (win32/posix, case, trailing-slash, drive-root, sibling, cross-drive, UNC)
- [x] 3. Scan diagnostics: volumeDiscovery.ts, penRoot.ts, shared/types.ts, PenRootContext.tsx, PenRootBar.tsx, locales
- [x] 4. CSS layout fix: global.css flex-wrap on .pen-root-bar / .pen-root-bar__actions / .pane__toolbar, min-width:0, overflow-wrap
- [x] 5. MyRecordingsScreen.tsx: clear resolved selections after success; clear other ops' stale panels on new op start
- [x] 6. Packaging: electron-builder.yml (per-arch target, no baked-in arch array) + package.json pack:mac:arm64/x64 scripts, scripts/checksum.mjs, scripts/afterPack.cjs (ad-hoc sign, afterPack not afterSign)
- [x] 7. build-windows.yml: new exe name + sha256 upload
- [x] 8. Reword about.downloadUpdateButton in 8 locales + SettingsScreen.test.tsx
- [x] 9. npm run typecheck && npm test all green (140 tests)
- [x] 10. Forensics on existing v0.2.4 arm64 DMG (hdiutil verify OK; codesign --verify FAILED — broken stale signature; spctl quarantine-simulated rejected with same broken-signature error; checksum cross-checked against pre-session local build artifact, matches)
- [x] local pack:mac:arm64 / pack:mac:x64 dry run — caught and fixed an electron-builder arch-flag bug (explicit yml arch array overrides CLI --arm64/--x64, built both archs and collided) — see lessons.md
- [x] ad-hoc sign verified real: codesign --verify passes on new build; quarantine-simulated spctl still rejects (expected — no Developer ID) but with a clean policy rejection, not the v0.2.4 broken-signature error
- [x] 11. Bump version 0.2.5, commit, tag, push — required two follow-up fixes after real CI failures: (a) electron-builder CLI -c.key=value templates broke on the Windows runner's cmd.exe (quoting), moved to electron-builder.mac-arm64.yml/mac-x64.yml via `extends`; (b) pen-root-bar action buttons still overflowed at 820px (flex-shrink:0 + no button min-width/wrap) — both fixed, tag re-pointed to final commit 3e234b5
- [x] 12. Build final mac dmgs from tagged commit (clean tree) — both ad-hoc signed, codesign --verify passes
- [x] 13. CDP verify: layout at 820px (overflow fixed, screenshot confirmed)/1100px, Settings shows v0.2.5/mac-arm64/"You're on the latest version" (correct — nothing published yet at time of check)
- [x] 14. gh release create v0.2.5, 3 installers + 3 sha256 sidecars uploaded, honest notes (Gatekeeper blocker explicitly marked unresolved); re-downloaded the published Apple Silicon dmg from the real GitHub URL and confirmed its checksum matches
- [x] 15. Update README
- [x] 16. tasks/lessons.md
- [x] 17. Final Traditional Chinese report
