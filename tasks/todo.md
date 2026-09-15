# BOOK database milestone — v0.3.0

User-approved plan: Option A (public, secret-free BOOK catalog/downloads, no
DRM), then a dual-pane redesign correction, then a real download-corruption
bug found and fixed against the live API.

- [x] `ponyabc-web`: new `GET /api/public/books` + `GET /api/public/books/download?id=`
      routes — no auth, active-only, id-based download (never a raw storage
      key), declared `original_filename` + full `friendlyNameI18n` exposed.
      `/api/pen/*` untouched. Implemented, tested, committed, **and deployed
      by the user** (Cloudflare Version ID e1efcaa5-9213-42d7-a524-f9e9a7e9a537).
      Verified live: real catalog (37 books), correct sizes/hashes/filenames/
      i18n names, a real download's on-disk hash matches exactly, unknown/
      malformed/missing ids all correctly rejected (400/404, indistinguishable).
- [x] Desktop pipeline: catalog client, JSON-manifest local persistence,
      streaming download+cache, safe pen install/replace/reinstall/remove,
      shared BOOK/DIY pen-write lock, full-hash cache identity, concurrent-
      download dedup.
- [x] **Critical fix**: a real download inside Electron's main process was
      silently corrupted by the `Readable.fromWeb()` + `stream/promises.pipeline`
      conversion (exact byte count, wrong SHA-256 — confirmed by the identical
      code being byte-correct in plain Node). The existing checksum check
      caught this every time and refused to write anything — never bypassed.
      Fixed by reading the WHATWG stream directly via its own reader. Found
      and fixed two related races while rewriting (cancellation must race the
      abort signal explicitly; temp-file cleanup must wait for the write
      stream to actually close before unlinking). Re-verified end-to-end
      against the real live catalog — on-disk hash now matches exactly.
- [x] **Dual-pane redesign** (per explicit correction, replacing the original
      single-list UI): left pane = pen's actual BOOK folder (matched or
      "Unknown"), right pane = App's BOOK database (catalog + cache), mirrors
      My Recordings' pattern. Unknown content is strictly read-only —
      enforced in the main process (`ipc/book.ts`'s `bookRemove` refuses
      anything not resolved to a matched, removable pen item), not just an
      omitted button. Retired the old "Unknown gets a backup, can be
      removed/restored" design; existing backups of that kind are kept on
      disk but `bookRestore` now refuses to restore one (blocks the one path
      that could have bypassed the new rule). Removed in-app developer notes
      about the cache directory / lack of encryption — kept in code comments
      only.
- [x] Tests: 249 total, typecheck clean both configs. New `bookIpc.test.ts`
      exercises the actual `ipc/book.ts` wrapper (mocking only `electron`) to
      prove the Unknown-content refusal is enforced there, not just inferred.
- [x] Real Windows CI green (typecheck/test/dist:win) on every push, including
      after the download-corruption fix and the dual-pane redesign.
- [x] Real CDP verification against the actual built app + the real live
      catalog + a simulated pen (never a real physical pen):
      catalog browses real metadata; a real ~6MB download completes and its
      on-disk hash matches the server-declared SHA-256 exactly; a genuinely
      differing matched book shows "On pen, differs from this version" (never
      "update available"); a genuinely unmatched file shows "Unknown" with no
      checkbox in the DOM; full real remove → backup → verify round trip
      against a genuine not-in-catalog fixture file (pre-redesign) and the
      new dual-pane Remove confirm flow (post-redesign); 820px layout has
      zero horizontal overflow; zero console errors throughout.
- [x] Version bumped to 0.3.0, tagged, mac DMGs built + codesign-verified,
      Windows exe downloaded from Actions + checksum-verified, GitHub release
      published with all three installers + SHA-256 + notes distinguishing
      hardware-tested (Apple Silicon, Windows x64) from build-only (Intel).

# v0.3.1 — real-world BOOK follow-up (connection status, diagnostics, NEW badge)

User reported the real packaged app showed every pen AXB as "Unknown" with a
top banner saying the catalog couldn't be reached — root-caused (real, not
assumed) via a CDP session against a completely fresh, never-cached user
profile hitting the live production API. Confirmed: no code bug in the
matching pipeline itself (a real AXB matched its real catalog entry and
showed its real name the moment the catalog loaded); the actual gap was that
a *failed* refresh attempt after an *earlier* successful one was invisible to
the user (`offline` was only true pre-first-success) — genuinely confusing
but not data-unsafe.

- [x] `ponyabc-web`: added `updatedAt` (row's `updated_at`) to the public BOOK
      catalog response — additive only, `/api/pen/*`/admin/auth untouched,
      full test coverage, committed. **Needs the user to `npm run deploy`
      again** (blocked here by the harness's own production-deploy
      safety gate, same as last round).
- [x] Connection status: `BookLibraryMeta.lastCheck` (state/httpStatus/
      itemCount/message/durationMs) tracks the *latest* fetch attempt
      independent of whether an older snapshot still exists. New
      `BookCatalogBar` (mirrors `PenRootBar`/`ComputerFolderBar` for real
      left/right layout parity with My Recordings) shows a dot + text:
      checking / connected+count / connected-but-empty (never shown as a
      failure) / server error with HTTP status / network unreachable, plus
      "using the last saved catalog (updated at X)" only when a real prior
      snapshot exists. Manual refresh only, no polling; refresh always
      clears its own busy state (verified live: click Refresh, busy state
      always resolves within the request's own timeout).
- [x] Matching-status split: `unknown` (a real catalog exists and this file
      genuinely isn't in it) vs new `awaiting-catalog` (no catalog has ever
      loaded — nothing to judge the file against yet), both read-only.
- [x] **Never hash to list**: `buildBookLibrary` is now hash-free and fast —
      a matched file whose current/differs status needs a hash comes back
      `matched-verifying`/`on-pen-verifying` immediately; a separate
      `verifyPendingHash` runs after, and one `bookVerifyUpdate` IPC push
      resolves the SAME pending entry in both panes at once (never hashes
      twice for one file). Verified live against a real 150MB dummy AXB on a
      fresh profile — the list renders immediately, the item resolves to
      "differs" shortly after via the push, no re-list call needed.
- [x] Diagnostics: capped (500-entry), redacted event log
      (`src/main/services/diagnostics.ts`) recording catalog-fetch attempts
      (url/httpStatus/duration/outcome/itemCount), pen-reconcile summaries
      (counts only), and BOOK download attempts (expected vs actual
      size/hash, outcome) — never tokens/auth headers/full local paths/
      personal data/audio-AXB bytes, verified by both unit tests and a real
      exported-summary read against the live session. Hidden entry point in
      Settings (passcode "00000000", explicitly not real access control) →
      summary + "Export diagnostics…" via a native save dialog, no
      auto-upload.
- [x] 14-day NEW badge: red "NEW" next to a book's name when the *server's*
      `updatedAt` (never local download/cache time) is within the last 14
      days of the real current clock, recomputed on every render so it
      expires on its own even from an offline-cached timestamp; missing/
      invalid timestamp never guesses. Independent of whether a re-download
      is needed.
- [x] `bookDownload.ts`'s hash-mismatch outcome now carries the actual
      observed size/hash, so the install-failure message names the specific
      book and the expected-vs-actual numbers instead of a bare generic
      string.
- [x] Tests: 271 total (was 249), both typechecks clean. New
      `bookNewBadge.test.ts`, `diagnostics.test.ts`; `bookReconcile.test.ts`
      and `BookLibraryScreen.test.tsx` extended for the two-phase
      verification model and the `awaiting-catalog` split.
- [x] Live end-to-end verification via CDP against the real packaged code
      path (electron-vite build + real Electron binary) with a **completely
      fresh, never-cached user-data profile** and a real ~150MB simulated
      pen AXB, hitting the real production API (never a fixture): real
      37-book catalog loads, real display name resolves instantly (no
      "Unknown"), connection bar shows real status/count/timestamp, manual
      refresh always clears busy, diagnostics passcode gate + summary work,
      zero console errors, zero 820px overflow. Never wrote to a real
      physical pen.

# v0.3.2 — refresh performance / verification-state cleanup

A consultant read `bookReconcile.ts`/`ipc/book.ts` from v0.3.1 and found the
real root cause of "refresh feels slow, ~9GB of reads observed": every
`bookList()`/`bookCatalogRefresh()` call regenerated a fresh "pending
verification" list and re-triggered hashing for every matched pen file —
`verifyInFlight` only deduped truly *concurrent* re-hashes of the same file,
it never remembered an already-completed result, so repeated UI actions
(mount → refresh → any add/remove triggering a re-list) kept re-reading the
same large AXBs from the pen over and over.

- [x] **Refresh is now hash-free, unconditionally.** `buildBookLibrary` no
      longer has any "pending verification"/auto-hash concept at all —
      `bookList`/`bookCatalogRefresh` only ever stat pen files (filename +
      size + mtime) and fetch catalog JSON metadata; they never read a pen
      file's bytes. A matched-but-unverified file is `'present'`/
      `'on-pen-present'` — filename+size match is explicitly never presented
      as "bytes confirmed identical."
- [x] **Verification is now a separate, explicit, user-triggered action** —
      "Verify selected content" (reuses the left pane's existing selection),
      with a matching Cancel. Download-hash verification and every
      destructive-operation safety check (pre-delete re-hash, backup-before-
      replace) are completely unchanged — this round only touched the
      *display/listing* path, never the write-safety path.
- [x] **Verification results are now persisted** in a small, capped
      (300-record, update-in-place-per-file) App-managed index
      (`bookVerifyIndex.json`, in userData — never written to the pen's own
      SD card this round), keyed by pen volume label + filename, valid only
      when the pen's device-identity generation, the file's exact size/
      mtime, and the catalog's current official hash all still match
      exactly — a mismatch on any of those (remount, file change, catalog
      update) falls back to unverified, never a stale guess. Confirmed live:
      a second refresh after an explicit verify shows the result *instantly*
      (108ms, matching the network-only refresh time) with zero re-hashing.
- [x] **Real, cancellable, byte-level verify progress** — new
      `sha256FileWithProgress` (in `transferService.ts`, separate from the
      unchanged `sha256File` used on safety-critical paths) reports
      cumulative bytes read and honors an `AbortSignal` that actually
      destroys the read stream (releasing the OS handle immediately, not
      just abandoning the promise — a real bug in the first version of this
      function, caught by wiring the actual EventEmitter 'error' path
      *before* any `destroy()` could fire, not by reasoning about it).
      Verify batches serialize through a batch-id guard so cancelling or
      starting a new batch can never let a stale one's results land late.
- [x] **Status wording is now unambiguous** on both panes: left = present /
      verifying / last-verified-matches / last-verified-differs / cannot-
      verify / awaiting-catalog / unknown; right = its own on-pen state
      *plus* a separate, independent cache-status line (not
      downloaded/cached/downloading) — an old download cache entry is never
      presented as "the latest version is confirmed on the pen."
- [x] Each catalog item now shows "Official update: <date>" using the
      server's own `updatedAt` (same field driving the NEW badge); the left
      pane's matching line is labeled the same way, never implying an
      install/update time the app doesn't actually track.
- [x] Diagnostics: new `pen-verify`/`pen-verify-batch` entries record the
      declared size, actual SD bytes read, read duration, and outcome
      (current/differs/cancelled/read-error) per file — separate from
      `catalog-fetch` (network JSON, tiny) and `book-download` (network AXB
      bytes) — confirmed live that a real 150MB explicit verify logs
      `sdBytesRead: 157286400` distinctly from the ~250-600ms `catalog-fetch`
      entries, so a real "why was there so much I/O" question is answerable
      from the log rather than defaulting to "must be the network."
- [x] Tests: 296 total (was 271), both typechecks clean. Rewrote
      `bookReconcile.test.ts` for the hash-free model; new
      `bookVerificationIndex.test.ts`, and `transferService.test.ts` gained
      `sha256FileWithProgress` coverage (including the cancellation-releases-
      the-handle proof and the real bug caught by the pre-aborted-signal
      test). `bookIpc.test.ts` gained full real-filesystem coverage of
      `bookVerifyContent`/`bookVerifyCancel` (persists a real record, refuses
      unmatched/stale-generation/no-pen, cancel-before-read-starts never
      touches the file).
- [x] Live end-to-end re-verification via CDP against a rebuilt binary with
      a fresh profile and the same real 150MB pen file: catalog load never
      auto-verifies, manual refresh completes in ~300ms regardless of the
      large file present, explicit verify resolves correctly to "differs"
      (content is random bytes, doesn't match the real official hash),
      second refresh reflects it instantly from the persisted index, zero
      console errors. Never wrote to a real physical pen.
