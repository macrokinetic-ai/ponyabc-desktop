# v0.2.6 — send-to-pen conflict UX, replace-sticker clarity, MP3 preview, app icon

Direct implementation per user's detailed spec (Traditional Chinese), no full replan
per explicit instruction.

- [x] Audited existing transfer/replace backend — conflict batch UI, exact-filename
      preservation, backup-before-replace, device-change-stop, selection-clear-on-
      success were already implemented from the v0.2.x safety work; this round is
      wording/labeling polish for items 1–2, not a rewrite
- [x] Reworded `actions.replaceSticker` button + `transferPlan.conflictsHint` +
      `replaceSticker.confirmText` (Computer:/Pen DIY: direction labels) across 8
      locales; added `replaceSticker.keepsFilename` soft-background note box
- [x] New audio preview feature (both panes): `src/main/ipc/audioPreview.ts`
      (validated read, resolveContainedFile + isEligibleMp3FileName, injectable size
      cap), `AudioSource`/`AudioPreviewResult` shared types, IPC channel + preload
      wiring, `useAudioPreview` hook (shared single `<audio>`, one-at-a-time,
      object-URL lifecycle), `AudioPreviewBar` component, preview buttons in both
      list panes, 8-locale strings
- [x] CSP: added `media-src 'self' blob:` (only change — script-src/object-src/
      sandbox/contextIsolation/nodeIntegration untouched) — required for the Blob
      object URL the preview player uses; documented why in index.html + report
- [x] Stops preview on pen swap/disconnect (`stopIfSource('pen')` on penIdentityKey
      change) and on computer-folder change; stops pen-side preview before any
      pen-write (send-to-pen confirm, replace-sticker confirm) — one-shot read design
      means no real Windows file-handle is held during playback anyway
- [x] CSS: `.recordings-list__row` flex layout (checkbox/name/size/preview button,
      no overlap at narrow widths), `.audio-preview-bar` + controls, `.note-box`
      (soft background + border, not color-only) with dark-mode variants
- [x] Tests: `tests/unit/audioPreview.test.ts` (9, backend validation incl.
      traversal/AppleDouble/size-cap), `MyRecordingsScreen.test.tsx` +6 (preview
      play/stop/switch/error/close/pen-change-stops-preview); updated 2 existing
      tests for new replace-sticker wording. 140 → 155 tests, typecheck clean
- [x] App icon: cleaned `ponyabc_logo1.png`'s baked-in opaque white card background
      via flood-fill (source PNG's "transparent" area was actually a rounded-card
      alpha=255 white shape, not truly transparent) → `build/icon.png` (1024×1024,
      transparent, logo centered) — electron-builder auto-generates .icns/.ico from
      this by convention (`directories.buildResources: build`), no config change
- [x] Commit (1271a90), tag v0.2.6 (does not overwrite v0.2.5), push — main +
      tag builds both green on real windows-latest (typecheck/test/dist:win)
- [x] Built mac dmgs from the tagged commit (clean tree); both pass
      `codesign --verify --deep --strict`; icon.icns confirmed wired via
      CFBundleIconFile
- [x] CDP verify with a real lame-encoded MP3 fixture (say + lame, since no
      ffmpeg/afconvert-mp3 available): pen preview plays with correct duration,
      switching files stops the previous one, computer-side shows the encoding
      hint, a corrupted .mp3 shows a clean error (not a hang), close releases
      the bar, zero overlap at 820px (all rows/actions/bar scrollW===clientW)
- [x] gh release create v0.2.6 — 3 installers + 3 sha256 sidecars, notes
      distinguish automated-tested vs Intel-paused-this-round; re-downloaded
      the published Apple Silicon dmg from the real URL, checksum matches
- [x] Final Traditional Chinese report
