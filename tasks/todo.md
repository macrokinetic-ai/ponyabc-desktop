# BOOK database milestone

User-approved plan: Option A (public, secret-free BOOK catalog/downloads, no
DRM). Approved implementing + deploying a minimal `ponyabc-web` change
(new public routes only, no change to the device/firmware/admin flow).

- [x] `ponyabc-web`: new `GET /api/public/books` + `GET /api/public/books/download?id=`
      routes — no auth, active-only, id-based download (never a raw storage
      key), declared `original_filename` + full `friendlyNameI18n` exposed.
      `/api/pen/*` untouched (its own tests still pass unmodified). 445/445
      tests pass, typecheck clean, lint clean, production build succeeds.
      Committed (`ea3e4da`). **Not yet deployed** — blocked by this
      environment's production-deploy safety gate; needs the user to run
      `npm run deploy` themselves.
- [x] Desktop data model (`BookCatalogEntry`/`BookCatalogSnapshot`/
      `BookCacheEntry`/`BookBackupEntry`/`BookItemStatus`/`BookLibraryItem`)
      in `src/shared/types.ts`; `src/shared/bookDisplay.ts` for the
      renderer-side instant-locale-switch display name resolution.
- [x] `bookStore.ts` (JSON manifest persistence, settingsStore.ts pattern),
      `bookCatalog/{client,fixtureClient,httpClient}.ts`,
      `bookCatalogValidate.ts` (duplicate/case-collision detection),
      `bookStatus.ts` (status derivation, install-eligibility gate),
      `bookReconcile.ts` (catalog+cache+pen merge, on-demand hashing only
      for matched files with a non-null catalog hash).
- [x] `penOperationLock.ts` (shared BOOK/DIY pen-write mutex) retrofitted
      into `transferPlanner.ts`'s `executeTransferToPen`/`executeReplaceSticker`.
- [x] `bookDownload.ts` — streaming download, full-hash cache identity,
      concurrent-request dedup (join in-flight; reinstall pre-empts),
      declared-size-exceeded abort, space checks, metadata-incomplete gate.
- [x] `bookInstall.ts` (add/replace-with-official/reinstall),
      `bookBackup.ts` (durable backup + cache-hash dedup reference,
      mkdirSync failure now caught cleanly — found via a test), `bookRemove.ts`
      (backup-before-delete, re-verify-hash-immediately-before-unlink,
      `target-changed-since-backup`), `bookRestore.ts`.
- [x] IPC: `bookList`/`bookCatalogRefresh`/`bookAdd`/`bookUpdate`/
      `bookReinstall`/`bookRemove`/`bookBackups`/`bookRestore`/
      `bookDownloadCancel`/`bookDownloadProgress`, wired through
      `ipc/book.ts` → `ipc/index.ts` → `preload/index.ts` → `PonyAbcApi`.
- [x] Renderer: `BookLibraryContext.tsx`, real `BookLibraryScreen.tsx`
      (replaces the placeholder), wired into `App.tsx`. Neutral
      "differs from official version" / "replace with official version"
      language throughout — no "update available" claim, no anti-copy/DRM
      claim.
- [x] i18n: `book.json` extended in all 8 locales.
- [x] Tests: 242 total (was 234 pre-BOOK), typecheck clean both configs.
      Fixed a real bug found while writing tests: `bookBackup.ts`'s
      `mkdirSync` wasn't guarded — a filesystem failure there would have
      thrown instead of returning a clean `backup-failed` result.
- [x] Pushed to `main`; real `windows-latest` CI run caught a genuine
      Windows-only bug on the first push (`sha256File` resolved on the read
      stream's `'end'` instead of `'close'`, racing the unlink right after
      hashing in `bookRemove.ts` — `ENOTEMPTY`/handle-still-open). Fixed,
      re-pushed, second Windows CI run fully green (typecheck/test/dist:win).
- [x] Real CDP verification against the actual built app (simulated pen via
      `PONYABC_TEST_VOLUMES_ROOT`, never a real physical pen):
      - Live catalog fetch genuinely attempted against
        `https://register.ponyabc.uk/api/public/books` (currently 404,
        since it isn't deployed yet) → correctly shows the "catalog could
        not be reached" banner, not a crash or a fake success.
      - 820px minimum window width: zero horizontal overflow, no overlap.
      - Zero console errors/exceptions.
      - Full real removal flow: a genuine "not-in-catalog" `.axb` file on
        the simulated pen → Remove → explicit confirm dialog (filename +
        freed space + backup notice) → Confirm → file actually deleted from
        the simulated BOOK folder AND a verified backup copy + correct
        manifest entry (reason: uncatalogued) appears on disk, offered back
        via "Restore to pen".
- [ ] **Blocked on the user**: deploy the committed `ponyabc-web` change
      (`npm run deploy`), then verify the live public endpoint for real.
- [ ] Once live: re-run CDP verification with the real catalog (real
      metadata rendering, a real download into the simulated BOOK folder),
      full suite + typecheck one more time, then `gh release create` the
      next unused version with Apple Silicon + Windows x64 + Intel
      installers and SHA-256, and report back with links + short test steps.
