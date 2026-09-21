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

# v0.3.3 — filename+size quick-match only; connect/browse/refresh never hashes

A follow-up spec (attributed to the user's consultant, confirmed against the
real v0.3.2 code) pointed out a real remaining gap: `buildBookLibrary`
matched pen files by filename only — it never compared the pen file's SIZE
against the catalog's declared size, so a filename match with a wrong size
fell through to the same "present"/"on-pen-present" bucket as a genuine,
size-correct, not-yet-hashed match. Connecting/opening/refreshing already
never hashed file content (fixed in v0.3.2), but this size-blind bucketing
meant a size-mismatched file couldn't be told apart from an ordinary
unverified match without the user manually running "Verify selected
content."

- [x] `BookPenMatchStatus` gained `'size-differs'`; `BookCatalogItemStatus`
      gained `'on-pen-size-differs'` — both decided purely from `fs.stat`
      (filename + size), never a content read. Takes priority over
      `'matched-hash-unknown'`/`'on-pen-present'` on the pen side (size
      mismatch is conclusive on its own); on the catalog side,
      `'metadata-incomplete'` (no declared hash — install-ineligible
      regardless of the pen) still takes priority, matching the pre-existing
      rule that an ineligible catalog entry is never actionable no matter
      what's on the pen.
- [x] Purely informational — never auto-replaces, never auto-deletes, never
      claims corruption. The item stays selectable/removable exactly like
      any other matched file; "Replace with official version" is offered
      the same way as for a hash-confirmed `on-pen-differs`. Explicit
      "Verify selected content" still works on a size-differs file if the
      user chooses to run it (resolves to `verified-differs`, which then
      supersedes the size-only guess with a confirmed result).
- [x] i18n: `status.sizeDiffers` / `status.onPenSizeDiffers` added to all 8
      locales (`en, zh-Hant, zh-Hans, es, fr, de, it, pt`) — verified all 64
      keys match across locales.
- [x] Tests: 300 total (was 296). New `bookReconcile.test.ts` cases (size
      mismatch wins over a matching-but-stale verify record, and over
      `matched-hash-unknown`, with the catalog-side metadata-incomplete
      precedence explicitly asserted); new `BookLibraryScreen.test.tsx`
      cases (left-pane size-differs stays selectable, right-pane
      on-pen-size-differs is actionable and requires the same Replace/Skip
      confirm as a hash-differs item).
- [x] Live CDP verification against a rebuilt dev binary with a completely
      fresh user-data profile and a real simulated pen volume
      (`<root>/PEN/BOOK` + `<root>/PEN/DIY`), using two real catalog
      entries from the live production API: one AXB written at the WRONG
      size (5MB vs. the catalog's declared 11.2MB) and one written at the
      EXACT correct size (54,064,704 bytes) with random (non-matching)
      content. Confirmed: catalog+pen reconciliation completes in ~256ms
      regardless of the 5MB+54MB on-pen files (no hashing); the
      wrong-size file shows "Size differs from official version" /
      "On pen — size differs from official" on both panes; the
      correct-size file shows the ordinary "On pen — not yet verified"
      (never claims verified); a manual refresh (~216ms) leaves the
      size-differs status unchanged (never auto-resolved); an explicit
      "Verify selected content" on the size-differs file still runs and
      resolves it to a confirmed "differs"; 820px minimum width has no
      horizontal overflow; zero console errors across the whole session.
      Never wrote to a real physical pen.

# v0.3.4 — collapsed-by-default rows; batch "download to App" (cache-only)

Follow-up after v0.3.3. The user flagged a real contradiction in the v0.3.3
report itself: the default list still showed the long "On pen — not yet
verified" wording, when the intent was a concise default list with full
detail only on demand. Also requested a genuinely new capability: a bottom-
of-right-pane batch download ("Download selected/all to App") that fetches
into the App's local cache only, one file at a time, with real per-file and
overall progress, cancel, and a completion summary — entirely separate from
"Add to pen".

- [x] **Collapsed-by-default rows.** Both panes now show only checkbox +
      name + NEW badge + a short status word/phrase by default (new
      `status.short*` i18n key set, e.g. "On pen" instead of "On pen — not
      yet verified", "Differs" instead of "On pen — verified, differs").
      Clicking the name (a plain-styled toggle button, not a real link)
      expands a detail block showing the raw filename, size, "Official
      update: <date>", the full/long status wording, and the per-item
      actions ("Verify this file" on the pen side, "Re-download" on the
      catalog side) — previously always visible, now detail-only.
      Non-removable pen rows (Unknown/awaiting-catalog) are unchanged: they
      had nothing to hide.
- [x] **Batch "download to App"** (`bookDownloadBatch`/
      `bookDownloadBatchCancel` IPC, `downloadToCacheOnly()` in
      `bookInstall.ts` reusing the existing cache-hit-skip logic from
      `addToPen`'s `resolveCacheFile`) — sequential, one file at a time,
      writes ONLY into the App's local cache directory, never the pen;
      "Add to pen" / "Replace with official version" remain wholly separate
      actions. A fully-matching cache entry is skipped with zero network
      activity and reported distinctly from an actual download in the
      completion summary (`Downloaded N · Skipped N (already cached) ·
      Failed N`). Real per-file byte progress (reuses the existing
      `bookDownloadProgress` channel/progress bar) plus a real batch-level
      "Downloading X of Y…" counter (new optional `completedCount`/
      `totalCount` fields on `BookDownloadProgressEvent`, populated only
      during a batch). A working Cancel button aborts whatever is currently
      mid-download and stops the rest of the batch from starting (mirrors
      the existing verify-batch's batch-id-supersedes-and-
      `bookDownloadBatchCancel()`-sets-the-authoritative-"not running"-flag-
      directly pattern from v0.3.2, applied to a second, independent batch
      kind). "Download selected to App" targets the existing catalog
      checkbox selection; "Download all to App" targets every catalog item
      that isn't `metadata-incomplete`/`ambiguous`, regardless of selection.
- [x] Tests: 314 total (was 300). New `downloadToCacheOnly` coverage in
      `bookInstall.test.ts` (real download, cache-hit skip, metadata-
      incomplete refusal, network-error); new batch describe block in
      `bookIpc.test.ts` (cache-hit-skip with zero network calls, a real
      download via a stubbed `fetch` with the batch position on its
      progress events, a cancel-mid-download race proven via a controllable
      never-resolving `fetch` mock that only settles on abort, a harmless
      no-op cancel, `no-items` for an empty/unknown target list — every one
      of these also asserts the pen's BOOK folder was never written to);
      `BookLibraryScreen.test.tsx` gained expand/collapse coverage and five
      new batch-download UI tests (trigger wiring, target-set selection,
      active-state button swap with a real counter, and a completion-
      summary render).
- [x] Live CDP verification against a rebuilt dev binary, a fresh user-data
      profile, and the real production catalog (37 books) with the same
      two simulated pen AXBs from v0.3.3 (one size-matched, one size-
      mismatched): confirmed the collapsed default list shows neither "not
      yet verified" nor "Official update:" text anywhere, only short status
      words; expanding a pen row reveals the official-update date and a
      "Verify this file" button; expanding a catalog row reveals the raw
      `.axb` filename and cache status; "Download selected to App" on the
      smallest real catalog item completes with a real completion summary
      and restores the trigger buttons; "Download all to App" against all
      37 real books shows a real "Downloading X of Y" counter and a working
      Cancel that stops it early with a `cancelled: true` summary; the
      simulated pen's BOOK folder held exactly the same 2 files before and
      after every download action (nothing was ever written to it); 820px
      minimum width has no horizontal overflow; zero console errors
      throughout. Never wrote to a real physical pen.

# v0.3.5 — Settings: "Privacy, Legal & Support" (no passcode required)

New user request, separate from the BOOK milestone work above: a Settings
section any ordinary user can open directly — unlike Diagnostics, never
gated behind the hidden passcode — covering privacy, legal/copyright, and a
support contact path. Explicitly required to be grounded in the REAL
website `/privacy` content and REAL app data flows, not assumptions, and to
never invent company/legal facts that aren't actually confirmed anywhere.

- [x] **Researched first, before writing any copy.** Read `ponyabc-web`'s
      `src/app/privacy/page.tsx` — confirmed it's explicitly marked
      "placeholder pending legal review" in its own source comment, scoped
      only to warranty-registration data (name/email/purchase date/intended
      use/pen serial), and says nothing about the desktop app at all — so
      it does NOT already cover the app, confirming the user's instinct not
      to assume it applied. No `/terms` route exists anywhere. Traced every
      network call in `ponyabc-desktop`'s main process (only 3 call sites
      exist: BOOK catalog/download → `register.ponyabc.uk`, no headers, no
      device/user id; GitHub update check → `api.github.com`, a static
      `User-Agent: PonyABC-Desktop-UpdateCheck`, no personal identifier).
      Confirmed DIY recordings, diagnostics, and settings are 100% local
      with zero network code anywhere near them. Confirmed `register.ponyabc.uk`
      runs on Cloudflare (R2 bucket + Workers, from `wrangler.jsonc`) — a
      real, citable fact, not a guess.
- [x] **Privacy section**: an offline-readable summary — version/last-
      updated line, then real, specific paragraphs on what stays local
      (DIY/BOOK), what's sent over the network and why (catalog/download
      requests, GitHub update checks, both described precisely — never "we
      don't collect any data"), the diagnostics log's actual shape/redaction/
      export mechanism, that warranty registration happens separately in an
      external browser, how long local content/logs actually stick around,
      and a rights/complaints paragraph naming the real (manual, email-only
      — self-service deletion is confirmed NOT built) request path and the
      ICO as the UK supervisory authority. A "Full legal company name,
      registration number, and registered address: to be confirmed" line
      and a "retention period... to be confirmed" line — neither invented,
      since neither exists anywhere in either repo. A button opens the real
      website privacy policy via a new dedicated `openPrivacyPolicyPage()`
      main-process handler (hardcoded URL, mirrors `openRegistrationPage()`
      — never reuses the registration opener for a different URL, a bug I
      caught and fixed before it shipped).
- [x] **Legal & Copyright section**: affirms (never limits) the user's own
      rights over their DIY recordings, states the BOOK-content license
      scope and the registered trade mark fact, notes the formal Terms of
      Use itself doesn't exist yet ("to be confirmed") rather than
      fabricating one and passing it off as final, and lists the MIT-
      licensed open-source dependencies (Electron, React, react-dom,
      react-i18next, i18next, mpg123-decoder).
- [x] **Contact Support section**: shows `marketing@ponyabc.co.uk`, a
      "Contact Support" button (new `openSupportEmail()` main-process
      handler — hardcoded recipient, renderer only ever supplies a subject
      line naming the app version/platform; the subject is percent-encoded
      so it can never inject extra mailto fields like cc/bcc/body — covered
      by a dedicated injection test), and a "Copy email address" button
      (reuses the existing About-panel clipboard pattern) that still works
      even if no mail client responds.
- [x] **Translation honesty**: only UI chrome (section/heading labels,
      button text, the notice itself) is translated into all 8 locales;
      the substantive Privacy/Legal body paragraphs are deliberately kept
      English-only (fetched via an explicit `{ lng: 'en' }` override
      regardless of the active UI language) with a translated notice
      explaining why — rather than shipping 7 languages of unreviewed
      legal-nuance translation and merely disclaiming it, per the explicit
      instruction not to pretend translations have been reviewed when they
      haven't.
- [x] Never gated behind the diagnostics passcode — visible immediately to
      any user who opens Settings.
- [x] Tests: 329 total (was 314). New `registrationAndSupport.test.ts` (7
      tests, including the mailto-injection-resistance case); 8 new
      `SettingsScreen.test.tsx` cases (passcode-free visibility, real
      behavior described without an unverified "no data collected" claim,
      "to be confirmed" placeholders present, English body persists across
      a live UI-language switch, the policy button calls the dedicated
      privacy opener and never the registration one, copy-email, contact-
      support subject contents, and the no-mail-client fallback hint).
- [x] Live CDP verification against a rebuilt dev binary with a fresh
      profile: the section renders with no passcode; real network facts
      (register.ponyabc.uk, github.com) and "to be confirmed" placeholders
      are visible; switching the UI language to zh-Hant translates the
      chrome/notice while the English legal body stays verbatim; 820px
      minimum width has no horizontal overflow; zero console errors. The
      actual "Contact Support"/"Open full policy" external-open actions
      were verified only via mocked unit tests, not by actually invoking
      `shell.openExternal` during the live CDP pass (that would have
      launched a real mail client/browser on the test machine).

# Firmware milestone — feasibility investigation (no code shipped this round)

Static investigation only, per explicit user instruction: did not execute
`isd_download.exe`/any `download.bat`, did not write to a real pen, did not
redistribute the vendor toolkit anywhere. Sources reviewed: `P5点读笔升级方法.pdf`,
`tools.zip` (listing + text/config files only — no `.exe`/`.bin` executed),
8 extracted frames of the vendor demo `.mp4` (no ffmpeg available; used
`avconvert`+`qlmanage` to sample ~8 timestamps), existing `ponyabc-web`
`/api/pen/firmware` route + `content.ts` firmware queries + admin content
upload, existing `ponyabc-desktop` `FirmwareScreen.tsx` (still a placeholder).

**Headline finding: `tools.zip` is NOT the P5 pen's firmware package.**
`tools/soundbox/standard/isd_config.ini` declares `CHIP_NAME=AC696X`,
`PID=AC696x_TWS`, `SDK_TYPE=SOUNDBOX` — a generic Jieli TWS-earbuds/speaker
reference SDK, using `br25loader.bin`. The vendor's own demo video shows the
real package is a Baidu-Netdisk-distributed `点读笔－升级工具－V1.12－.rar`
(19.3MB, dated 2025-01-23) whose internal `tools` folder is named
`师大pen－V1.12－20250109` and uses `br23loader.bin`/`.uart` — a different
loader than both `tools.zip` (br25) and the PDF's own older example
screenshot (br21). Full report given to the user in chat.

- [ ] Vendor must supply the actual current P5-pen-specific flash package
      (matching the "师大pen" folder layout seen in the demo video), not the
      generic AC696X/soundbox SDK currently in `tools.zip`.
- [ ] No code implemented this round — investigation/recommendation only.

**CORRECTION (next round):** the "headline finding" above was WRONG and is
withdrawn. The user has personally, successfully flashed a real P5 pen using
this exact `tools.zip` — a real confirmed outcome outranks static config-
string evidence. `CHIP_NAME=AC696X`/`PID=AC696x_TWS`/`SDK_TYPE=SOUNDBOX` and
the br25-vs-br23 loader naming are real observations, but vendors routinely
reuse/relabel shared SDK templates across product lines without renaming
internal config strings — a "wrong-looking" label is not proof of a wrong
config. Lesson captured in `tasks/lessons.md`. Proceeding on the basis that
`tools.zip` IS viable; the open question now is only WHICH exact entry
point inside it the user actually ran (root `tools/download.bat` vs.
`tools/soundbox/standard/download.bat`), asked directly in chat.

# Firmware milestone — confirmed entry point + working wizard (test/dev mode)

User confirmed the successful real-P5 upgrade entry point: root `tools\download.bat`
(not `download-nokey.bat`, not manually entering `soundbox\standard`).

- [x] **Full dependency-chain trace of `tools\download.bat`.** It's a build/
      post-link wrapper needing `C:\JL\pi32\bin\llvm-objcopy.exe` (a dev-only
      toolchain path essentially never present on an end-user PC), so its
      `objcopy`/`objdump` steps are a no-op (cmd.exe prints "not recognized"
      and leaves every target file untouched) when that toolchain is missing.
      **CORRECTED (2026-09-15) — see the verification round below: the
      original claim that the trailing `copy /b ...+bank.bin app.bin` "can't
      ever produce fresh output" because `bank.bin` is missing was WRONG as a
      mechanism.** Real `copy /b` does not abort or skip the destination when
      one source in the list is missing — it silently drops just that source
      and still overwrites the destination from whichever sources ARE
      present, exit code 0, no error text. The reason the net effect is still
      a no-op for THIS package is a *fact about the package's current bytes*
      (verified by hash, not inferred from the missing file): concatenating
      the 13 present sources reproduces `app.bin` byte-for-byte. That's a
      narrower, more fragile guarantee than originally claimed — see below.
- [x] **Real bug found via this trace, fixed, and proven on real Windows
      CI**: the confirmed chain ends in a bare `pause` (waits for a keypress
      that automation can never provide) — `elevatedRun.ts` now redirects
      the target's stdin from `nul` so `pause` sees immediate EOF. A
      harmless-target smoke test with a trailing `pause` confirmed this
      resolves in ~1.5s instead of hanging, on a real windows-latest runner
      (dispatched twice; the first real run also caught two unrelated test-
      infra bugs — Vitest's 5000ms default per-test timeout being shorter
      than the internal 60s runElevated timeout, and a Windows EBUSY on temp-
      dir cleanup — both fixed and reconfirmed passing on a third real run).
- [x] **Original package preserved, never modified/regenerated.** The app
      invokes the user's own extracted `download.bat` exactly as-is —
      `startFirmwareUpgrade` never writes into the package folder, never
      calls any inner tool directly, never re-derives firmware bytes itself.
- [x] **Windows wizard UI (real, not just simulated) built**: Prepare →
      Package → Confirm → Upgrading → Result. "Package" step is an explicit
      dev/test-mode local-folder picker (validates required-file presence
      only — never infers a version from the folder name or file dates);
      real download-and-verify against an official server catalogue needs a
      new public firmware API, not built this round (see the proposal
      below). "Upgrading" shows real phase text (preparing / awaiting-
      authorization-or-starting — Windows gives no clean signal to tell
      these two apart from outside the elevated process, disclosed as such
      / tool-running / finishing) plus the real live log tail — no fake
      percentage anywhere, and no cancel button once started. "Result"
      distinguishes success (ONLY ever the literal "download success" string
      appearing in the tool's real output — a real exit code of 0 is never
      by itself sufficient, since the confirmed chain's own batch scripts
      never check errorlevel after the actual flash step) from failed
      (declined UAC / launch error) from unclear (everything else, including
      a timeout) — unclear requires an explicit user acknowledgement before
      the pen-write lock and the "already in progress" guard clear, so a
      genuinely ambiguous result can never silently allow a second attempt
      or a BOOK/DIY write while the device might still be mid-flash.
- [x] Firmware upgrade holds the existing shared `acquirePenLock()` for its
      entire duration (real mutex with BOOK/DIY pen writes) plus a dedicated
      `firmwareLock.ts` guard refusing a second concurrent attempt outright.
- [x] Tests: 367 total (was 347 before this session's firmware work; 365
      passing + 2 Windows-only-opt-in skipped locally). New
      `elevatedRun.test.ts` (15), `elevatedRun.windows-smoke.test.ts` (real-
      Windows-only, opt-in), `firmwareUpgrade.test.ts` (11, pure outcome-
      determination + package validation), `FirmwareScreen.test.tsx` (9,
      full simulated wizard flow: pen-gate, invalid package, explicit-
      confirm-required, real phase/log rendering with no fake percentage and
      no cancel button, success/failed/unclear all rendering distinctly,
      unclear requiring acknowledgement before reset, double-click-start
      surfacing "already-in-progress" rather than a duplicate real run).
- [x] Minimal server-side proposal (not implemented/deployed): existing
      `/api/admin/content/upload-url` already accepts a `.zip` firmware
      artifact with ZERO schema changes (extension validator already allows
      1-8 alphanumeric chars); the one real gap is a new public, secret-free
      `/api/public/firmware` + `/api/public/firmware/download`, mirroring
      `/api/public/books` exactly (id-based download URL, re-validated per
      request) — `/api/pen/firmware` stays bearer-gated and unchanged.
- [ ] Real-device test steps handed to the user for their own Windows
      notebook — see chat. Not run by the agent; no real pen was flashed,
      no cable-pull/power-cut test was performed.

# Firmware milestone — targeted re-verification of "harmless no-op" claim (2026-09-15)

User (correctly) rejected the earlier "all pre-steps are harmless no-ops" framing:
missing `bank.bin` doesn't prove `copy /b` won't touch `app.bin`, and matching file
*size* doesn't prove matching *bytes*. No vendor tool was executed this round; no
real device was touched; no vendor package was uploaded anywhere.

**CONFIRMED, from a real Windows runner (GitHub Actions `windows-latest`), 100%
synthetic placeholder files, vendor tool never invoked** —
`.github/workflows/copy-b-synthetic-repro.yml` (manual `workflow_dispatch` only,
same pattern as the existing elevation-smoke workflow), run
[34976484902](https://github.com/macrokinetic-ai/ponyabc-desktop/actions/runs/34976484902):
`copy /b f1+f2+f3+missing.bin dest` does **not** error out or leave `dest`
untouched when `missing.bin` doesn't exist — cmd.exe silently drops just that one
source from the list (no error text, exit code 0, "N file(s) copied.") and still
overwrites `dest` with the concatenation of whichever sources DO exist. True
whether `dest` pre-existed or not, and whether the missing file was last in the
list (matches the real `bank.bin` position) or in the middle. **The original
report's mechanism claim was wrong** — the copy is a real, unconditional write on
every run, not a guaranteed skip.

**CONFIRMED, by SHA-256 (not size) computed directly from the untouched
`tools.zip` stream via `unzip -p | shasum`, never from possibly-touched extracted
copies** — three independent facts:
1. No `bank.bin` file exists anywhere in `tools.zip` (strict path-component match,
   not just a substring grep — `ai_single_bank`/`ai_double_bank` directory names
   don't count).
2. Root `app.bin` / `br25loader.bin` are **byte-identical** (not just same-size) to
   `soundbox\standard\app.bin` / `br25loader.bin` — hash
   `0d8c86ea...adee16dc` / `6cb7f0f9...a160ea83` respectively, matched on both
   copies.
3. Concatenating `text.bin+data.bin+data_code.bin+aec.bin+wav.bin+ape.bin+
   flac.bin+m4a.bin+amr.bin+dts.bin+fm.bin+mp3.bin+wma.bin` — exactly the
   `copy /b` line's source list with only the always-absent `bank.bin` omitted —
   reproduces `app.bin`'s exact SHA-256, `0d8c86ea...adee16dc`.

**Net, corrected conclusion:** given fact (1) proven with certainty via the CI repro
above, `copy /b` DOES execute and DOES overwrite `app.bin` on every run of this
script. But fact (3) proves that, for the *exact bytes currently sitting in
`tools.zip`*, that overwrite reproduces the identical file — so the observed
practical effect (no change) still holds, just for a package-content reason, not a
missing-file-blocks-the-copy reason. This is a **narrower and more fragile**
guarantee than originally claimed: it holds only as long as `text.bin`/`data.bin`/
`data_code.bin`/`aec.bin`/`wav.bin`/etc. keep exactly these bytes. It is NOT a
property of the script that would survive, e.g., a different/updated package where
those files differ even slightly — a future package could get a silently wrong
`app.bin` with zero error signal, and this same investigation would need to be
redone against that package's own bytes.

**UNVERIFIED — flagged, not resolved, per instruction not to execute vendor
tools:** `remove_tailing_zeros.exe` (unlike the `objcopy`/`objdump` steps) is
*not* gated on the missing dev toolchain — it ships in the package and its inputs
(`aeco.bin`/`wavo.bin`/etc., also pre-shipped) are already present, so on a real
end-user Windows PC this step plausibly *does* actually execute and overwrite
`aec.bin`/`wav.bin`/`ape.bin`/etc. with a freshly recomputed result. Whether that
recomputed result is byte-identical to the pre-shipped `aec.bin`/`wav.bin`/etc.
(the ones fact (3) above relies on) has **not** been checked — doing so would mean
running the vendor's own `.exe`, which is exactly what the user asked not to do
this round. This is the one remaining load-bearing gap in "the whole chain is a
no-op": everything downstream of `remove_tailing_zeros.exe` has now been verified
by hash; whether `remove_tailing_zeros.exe` itself is a no-op on this package has
not.

**Success-signal audit (`src/main/services/firmwareUpgrade.ts` `determineOutcome`,
`src/main/ipc/firmware.ts` `startFirmwareUpgrade`) — confirmed by code reading, no
changes needed:**
- The log is genuinely fresh every run: `workDir` (containing `run.log`) is
  `fs.rmSync(..., force: true)`-deleted before every invocation, and
  `accumulatedLog` is a fresh local variable per call — a stale log from a
  previous attempt cannot leak a "download success" string into a new run.
- `"download success"` is matched against the full accumulated log text (not the
  4000-char UI excerpt, so truncation can't cause a false negative), and is only
  ever consulted after `elevation.status === 'completed'` — i.e. after
  PowerShell's `Start-Process -Wait` has confirmed the elevated process actually
  exited. A string appearing while the tool might still be running can't trigger
  success; declined/launch-error/timeout/unsupported/unparseable are all
  intercepted before the log is ever consulted, so a real exit code is carried
  through for diagnostics but deliberately never overrides the log signal either
  way (documented in the source: the vendor's own chain never checks `errorlevel`
  after the actual flash step, so a "clean" exit code isn't trustworthy signal to
  contradict a real "download success").

**"I understand" gating (`acknowledgeFirmwareOutcome`, `FirmwareScreen.tsx`,
`penOperationLock.ts`) — confirmed by code reading, no changes needed:** for an
`unclear` outcome, both the firmware in-progress guard and the pen-write mutex
(`acquirePenLock()`, the same lock every BOOK/DIY write path
(`bookInstall.ts`/`bookRemove.ts`/`bookRestore.ts`/`transferPlanner.ts`) acquires)
stay held until `acknowledgeFirmwareOutcome()` runs. The "I understand" button
calls only that — it releases the lock and resets the wizard to `prepare`; it does
**not** itself start a new burn or perform any BOOK/DIY write. Any BOOK/DIY write a
user triggers while `unclear` is still pending sits queued on the shared mutex
(never silently dropped, never silently run early) and only proceeds once
acknowledged — and only because the user's own separate click on that write
already authorized it, not because of the acknowledge click.

**No code changes were required this round** (the success-detection and
lock-gating logic already satisfied items 4–5; only `tasks/todo.md`'s prose
conclusion needed correcting) — so **no new installer build is needed**. The
confirmed root-entry-point behavior (`tools\download.bat`, never
`download-nokey.bat`, never manually entering `soundbox\standard`) is unchanged
and was not touched. Before a real burn: the `remove_tailing_zeros.exe` gap above
is the one open question the user should weigh — it can only be closed by either
running the vendor tool once under supervision (outside this round's scope) or by
accepting the residual risk it names.

# Firmware milestone — real code fixes for the lock-safety gaps (v0.3.7, 2026-09-15)

User correctly rejected the previous round as documentation-only and pointed at
three specific, still-open code defects. All three fixed; no vendor tool
executed, no real pen touched, no full re-investigation.

- [x] **`acknowledgeFirmwareOutcome()` no longer trusts the user's click as proof
      the elevated process stopped.** `FirmwareUpgradeOutcome` gained a new field,
      `processTerminationConfirmed: boolean` (`src/shared/types.ts`) — true only
      when there is positive evidence the elevated process is no longer running
      (never launched at all, or PowerShell's `Start-Process -Wait` genuinely
      returned). `determineOutcome()` (`firmwareUpgrade.ts`) sets it false for
      exactly `'timeout'` and `'unparseable-wrapper-output'` — the two cases where
      the real process's state is genuinely unknown. `startFirmwareUpgrade()`
      (`firmware.ts`) now only ever stashes `pendingRelease` when this flag is
      true; when it's false, NEITHER the pen lock NOR the firmware in-progress
      guard are released, and no reference to the release function is kept
      anywhere reachable from the UI. `acknowledgeFirmwareOutcome()` is now a
      pure function of whether something was actually stashed — for a
      not-confirmed outcome it returns `{ ok: false, locked: true }` and touches
      nothing. The only way to clear this state is fully restarting the app
      (both locks are in-memory module state that resets on its own).
- [x] **`startFirmwareUpgrade()`'s catch block distinguishes "confirmed nothing
      launched" from "the launch was attempted, outcome unknown."** Previously
      ANY caught error unconditionally released both locks. Now two flags
      (`calledRunElevated`, `elevationResult`) track whether `runElevated()` was
      ever invoked and, if so, what it returned before the throw. Termination is
      only treated as confirmed if the throw happened before `runElevated()` was
      called (`reason: 'internal-error-before-launch'`) or after it resolved with
      `status: 'completed'`; a throw during/after an attempted-but-unresolved
      launch (`reason: 'internal-error-uncertain'`) leaves both locks held with
      no in-app release path, same as a timeout.
- [x] **`REQUIRED_RELATIVE_FILES` (`firmwareUpgrade.ts`) now traces the real
      root `download.bat` → `soundbox\standard\download.bat` call chain** instead
      of the earlier no-op-derived list: adds `remove_tailing_zeros.exe` (the
      processing tool that is NOT toolchain-gated — see the verification round
      above), all 13 `copy /b` concatenation sources (text.bin/data.bin/
      data_code.bin/aec.bin/wav.bin/ape.bin/flac.bin/m4a.bin/amr.bin/dts.bin/
      fm.bin/mp3.bin/wma.bin), `soundbox\standard\`'s `tone.cfg`/`cfg_tool.bin`
      (isd_download.exe's `-res` args), the exact `-key` argument
      (`026AC690X-5309.key` — the package's OTHER `.key` file is never actually
      passed and stays unlisted), `jl_isd.fw` (ufw_maker.exe's input), and
      `isd_config.ini` (the chip/board config — consumption path not fully
      traced, required anyway since every confirmed-working layout has it).
      `bank.bin` stays deliberately excluded — see the verification round above.
      Doc comment corrected to state plainly that this check is a necessary
      precondition, never a claim the package is confirmed-compatible or safe.
- [x] **Renderer**: `FirmwareScreen.tsx` branches the "unclear" result screen on
      `outcome.processTerminationConfirmed`. Confirmed → unchanged existing
      acknowledge flow (resets the wizard). Not confirmed → a distinct warning
      body, a differently-labeled button ("I understand — I will restart the
      app") that calls the same IPC method for an audit trail but deliberately
      never resets wizard state, and a persistent post-click notice explaining
      the app stays locked until fully restarted. New i18n keys added to all 8
      locales (`unclearBodyUnconfirmed`, `acknowledgeButtonUnconfirmed`,
      `restartNoticeAcknowledged`).
- [x] **Targeted regression tests, 100% simulated (mocked `runElevated`, no
      vendor tool, no pen)**: new `tests/unit/firmwareIpc.test.ts` (7 tests)
      exercises `src/main/ipc/firmware.ts` end-to-end with a fresh module graph
      per test (`vi.resetModules()` + dynamic import — necessary because the
      "not confirmed" cases intentionally leave module-level lock state
      permanently held, which would otherwise leak across tests) — success,
      unclear-confirmed (acknowledge releases + a queued `acquirePenLock()`
      caller then proceeds), timeout and unparseable (acknowledge is proven a
      no-op — the core regression check for item 1), an error before vs. after
      the launch was attempted (item 2), and a declined UAC prompt (unaffected
      control case). `firmwareUpgrade.test.ts` updated: `writeFullPackage()`
      now writes the full corrected file list, new tests per required-file
      category (concatenation source / processing tool / config / key), and
      `processTerminationConfirmed` assertions added to every `determineOutcome`
      case. `FirmwareScreen.test.tsx` updated similarly, plus a new test proving
      the not-confirmed screen never shows the normal acknowledge button and
      never navigates back to "Prepare your pen." **385 tests pass** (was 367);
      `typecheck` and `electron-vite build` both clean.
- [x] Version bumped to **v0.3.7** (`package.json`) for a real Windows test
      installer build via the existing `build-windows.yml` CI workflow (builds
      real `windows-latest`, uploads `windows-installer` artifact — exe +
      sha256). No vendor firmware package is bundled into the app; this only
      packages the Electron app itself.
- [ ] **Still open, unchanged from the previous round:** the
      `remove_tailing_zeros.exe` regeneration question — whether it actually
      running on this package's `aeco.bin`/`wavo.bin`/etc. reproduces the
      currently-shipped `aec.bin`/`wav.bin`/etc. bytes — remains unverified.
      Resolving it would require running the vendor tool, which continues to be
      out of scope unless the user explicitly asks for it.

# Firmware milestone — cross-restart recovery: a restart is NOT evidence of termination (v0.3.8, 2026-09-15)

User correctly pointed out the v0.3.7 fix still had a hole: it relied on "restarting the app
resets the in-memory lock" as the escape hatch for a genuinely-uncertain outcome — but the real
elevated process (`isd_download.exe` etc., running in a separate elevated process tree, per
`elevatedRun.ts`'s own doc comment) could still be running after the Electron app itself is fully
quit and reopened. Fixed for real, not documented around.

- [x] **`src/main/services/firmwareRecovery.ts` (new)** — persists a `PendingFirmwareRun` marker
      (`startedAtMs`/`workDir`/`packageDir`/`entryBatPath`) to `<userData>/firmwareRecovery/
      pending.json`, deliberately NOT inside the `firmwareRun/` scratch dir that
      `startFirmwareUpgrade` wipes at the top of every run — this marker must survive that wipe,
      an app crash, and a plain quit. `listRunningProcessesWindows()` shells out to
      `Get-CimInstance Win32_Process` (gives `CommandLine`, unlike plain `tasklist`) — strictly
      read-only, never signals/suspends/kills anything. `matchesPendingRun()` is a broad,
      case-insensitive substring match of the pending `workDir`/`packageDir` against a process's
      executable path or command line — deliberately not an exact PID match, since the real
      elevated PID was never captured in the first place (`Start-Process -Verb RunAs -PassThru`'s
      `$p` is only assigned once `-Wait` itself returns). `checkStillRunning()` reports 'unknown'
      (never 'not-running') if the enumeration itself fails — a failed check must never be treated
      as safe.
- [x] **`src/main/ipc/firmware.ts`**: `startFirmwareUpgrade` now calls `writePendingRun()` right
      before the elevated launch is attempted (survives a crash mid-flight) and `clearPendingRun()`
      the moment `processTerminationConfirmed` becomes true (both the immediate-release and the
      confirmed-but-unclear pendingRelease branches, and the catch block's confirmed-safe branch)
      — independent of whether the user has acknowledged anything. New
      `checkPendingFirmwareRecoveryOnStartup()` — called exactly once, at app startup, BEFORE
      `registerIpcHandlers` (see `src/main/index.ts`) — reads any pending marker, seeds BOTH the
      pen lock and the firmware in-progress guard as held before any IPC handler exists to race
      it, and runs one real `checkStillRunning`. `recheckFirmwareRecovery()` re-runs the same
      check on demand (a "Check again" button); a no-op once already resolved. Both expose their
      result via a new `FirmwareRecoveryStatus` (`'none' | 'checking' | 'still-running' |
      'unknown'`) through `getFirmwareRecoveryStatus()`. Crucially: **nothing in this path — not
      `acknowledgeFirmwareOutcome()`, not the recovery IPC itself — can release either lock for
      `'still-running'`/`'unknown'`; only `checkStillRunning` reporting `'not-running'` does, and
      this app never attempts to terminate the other process itself.**
- [x] **Renderer**: `FirmwareScreen.tsx` queries `getFirmwareRecoveryStatus()` on mount and, while
      it's anything but `'none'`, renders a dedicated blocking screen (distinct body text for
      "still running" vs "check failed/unknown", the pending run's start time, last-checked time,
      and a "Check again" button) INSTEAD of the normal wizard — the wizard steps never render
      underneath it. New i18n keys (`recovery.*`) added to all 8 locales.
- [x] **Tests, all simulated/injectable except one opt-in real-Windows suite:**
  - `tests/unit/firmwareRecovery.test.ts` (12 tests) — pure logic: marker round-trip, survives a
    simulated `firmwareRun/` wipe, malformed/missing file handling, `matchesPendingRun` string
    matching, `checkStillRunning` with an injectable process lister (running/not-running/the
    listing itself throwing → 'unknown').
  - `tests/unit/firmwareIpc.test.ts` — new "cross-restart recovery" describe block (4 tests)
    directly simulates **"app closed/reopened while an external process may still be running"**:
    a `vi.resetModules()` mid-test (fresh in-memory state, same on-disk userData — a real
    restart's exact effect) after a `'timeout'` outcome, confirming the persisted marker alone
    (re-read by the new session) re-locks both the pen lock and the in-progress guard with
    `checkStillRunning` mocked to 'running', that a queued BOOK/DIY-style `acquirePenLock()`
    caller and a new `startFirmwareUpgrade` attempt both stay correctly blocked, and that only a
    subsequent check reporting 'not-running' clears the marker and both locks. Plus an 'unknown'
    variant and two no-pending-state no-op controls.
  - `tests/unit/FirmwareScreen.test.tsx` — 5 new tests: the recovery screen blocks the normal
    wizard for 'still-running'/'unknown' with the right distinct body text, "Check again" both
    unblocking (on a 'none' response) and correctly staying blocked (on a repeat 'still-running'
    response), and the 'none' common case rendering the wizard immediately.
  - `tests/unit/firmwareRecovery.windows-smoke.test.ts` (new, opt-in via
    `PONYABC_RUN_RECOVERY_SMOKE=1`, real Windows only) + `.github/workflows/
    firmware-recovery-smoke.yml` (manual-dispatch-only, same pattern as the existing elevation
    smoke workflow) — spawns a genuinely-still-running, completely harmless placeholder `.bat`
    (`ping -n 60 127.0.0.1 >nul`) on a real `windows-latest` runner, runs the REAL
    `checkStillRunning` (real `Get-CimInstance` enumeration, not mocked) against it, confirms it
    reports `'running'`, kills the placeholder (test cleanup of its own harmless stand-in, not
    the vendor tool), and confirms a repeat check reports `'not-running'`. This is the one part of
    the fix that genuinely needs a real OS and can't be proven by a mock alone.
  - **400 tests pass, 4 skipped** (the two real-Windows-only smoke test files, opt-in outside
    CI); `typecheck` and `electron-vite build` both clean.
- [x] Version bumped to **v0.3.8**.

# Firmware milestone — official-download flow (v0.3.9-in-progress, 2026-09-15): script.ver required-file correction, verified with real Windows CI, not assumed

While building the Windows-only official-download flow (new `firmwareCatalog`/`firmwareDownload`/
`firmwareExtract`/`firmwareRelease` modules — download → SHA-256 verify → safe zip-slip-guarded
extract → the existing, unmodified `startFirmwareUpgrade`/`inspectFirmwarePackage` chain), running
the real `tools.zip` through the new pipeline end-to-end surfaced that it has no root-level
`script.ver` — only `soundbox\standard\script.ver`. `REQUIRED_RELATIVE_FILES` required the
root-level copy, so the real package failed validation.

- [x] **Did not assume the prior `copy /b` (`bank.bin`) finding covered this.** The user
      explicitly rejected that shortcut — a multi-source `copy /b` skip-and-continue and a
      single-source `copy source dest` against a missing source are different mechanisms, and
      only the former had ever actually been tested. See the new `tasks/lessons.md` entry.
- [x] **Ran a real, harmless Windows CI verification**
      (`.github/workflows/firmware-scriptver-copy-smoke.yml`, manual-dispatch only, needs zero
      repo checkout — pure synthetic files): reproduces exactly `tools\soundbox\standard\
      download.bat`'s own `cd %~dp0` + `copy ..\..\script.ver .` lines against a root-absent/
      nested-present skeleton. Never invokes any vendor tool, never touches a device, never
      modifies the real `tools.zip`. Run `35014413934`: copy failed with the real cmd.exe error
      ("The system cannot find the file specified.", errorlevel 1), the nested `script.ver` was
      byte-for-byte unchanged after (SHA-256 identical before/after), and the batch continued to
      its next line — committed and pushed to `main` directly (a `workflow_dispatch` workflow
      must exist on the default branch to be dispatchable at all; the file itself only ever runs
      on manual trigger).
- [x] **Corrected `REQUIRED_RELATIVE_FILES`** (`firmwareUpgrade.ts`) to require
      `soundbox\standard\script.ver` (the real point of consumption) instead of the copy step's
      absent root-level source, with a doc comment citing the exact run/evidence — explicitly
      scoped as proof of only this one copy step's failure mode, not of
      `isd_download.exe`/`ufw_maker.exe`/`remove_tailing_zeros.exe` succeeding or any real flash
      outcome. Updated the three test files with their own hand-mirrored required-file lists
      (`firmwareUpgrade.test.ts`, `firmwareExtract.test.ts`, `firmwareIpc.test.ts`) to match.
- [x] **Added targeted regression tests** (`firmwareUpgrade.test.ts`): root absent + nested
      present → still `looksValid`; both absent → still correctly flagged, at the real nested
      path (never the old root path). Also surfaced `missingFiles` through
      `FirmwareExtractOutcome`/`FirmwarePrepareResult` so the official-download UI shows the same
      specific missing-path list the local-folder path already did, instead of a generic message.
- [x] **The real `tools.zip` end-to-end test now asserts `status: 'ok'`** (was previously a
      documented, honest "currently fails on this one known gap" branch) — the real package
      genuinely passes the corrected check now. Not a re-upload of the zip; a corrected
      understanding of where the confirmed chain actually needs the file.
- [x] **432 tests pass, 4 skipped**; `typecheck` clean.
- [ ] **Still unverified, explicitly not claimed by any of the above:** whether
      `isd_download.exe`/`ufw_maker.exe` actually succeed against a real pen with this package,
      and the still-open `remove_tailing_zeros.exe` regeneration question from the v0.3.7 round.
      Resolving either requires running the vendor tool against real hardware, which remains out
      of scope unless the user explicitly asks for it.

# Result-screen simplification + structured firmware diagnostic logging

User request (bilingual, single turn): (A) simplify the "normal completion" result screen down to
exactly one calm message + one "Finish" button (removes the old playback-feedback button, the
"I understand — result unclear" acknowledge button, and the red "result could not be confirmed"
title whenever the outcome is a normal completion), where "Finish" ends the wizard and quits the
app but is only ever reachable/enabled once the upgrade is confirmed to have ended; and (B) a
separate, detailed, local-only, per-attempt firmware diagnostic logging system feeding a new
Settings → Support → "Export firmware diagnostic logs" button, entirely independent of the now-
simple UI.

- [x] **Part A — FirmwareScreen.tsx result step rewritten.** Exactly one `<p>` message (the
      calm success or neutral "process has finished" text) + one "Finish" button whenever
      `outcome.processTerminationConfirmed && outcome.status !== 'failed'` (covers BOTH a real
      success signal AND a confirmed-terminated-but-ambiguous outcome — both get the same calm
      UI, differing only in which of the two i18n strings is shown). `failed` and
      not-yet-confirmed-terminated states keep their own distinct, truthful messages/buttons
      (`Start over` / the existing "I understand — I will restart the app" persistent-lock
      notice) — never uniformly shown as "completed". The internal `status`/`reason` distinction
      is preserved (now durably, in the new session log below) even though the two "normal
      completion" cases render identically calm text.
- [x] `handleFinish()` (`FirmwareScreen.tsx`) calls `acknowledgeFirmwareOutcome()` then
      `finishFirmwareUpgrade()` (new IPC, `src/main/ipc/firmware.ts`) — releases any pending lock
      (no-op if already released, e.g. a real 'success') and calls `app.quit()`. Never reachable
      from a not-yet-confirmed-terminated state (no button renders there) and never force-kills
      the vendor process — quitting the Electron app has no effect on an already-confirmed-gone
      elevated process, and the pre-existing persisted pending-run marker
      (`firmwareRecovery.ts`) already protects the one case that matters (termination NOT yet
      confirmed) across ANY app exit, clean or not — unchanged by this round.
- [x] Removed entirely (button, IPC, i18n keys, and the result-screen "Technical details"
      block that only ever showed on the outcome screen): "I tested the pen — it plays
      normally" (`recordFirmwarePlaybackFeedback`), the old "I understand — result unclear"
      acknowledge-and-reset flow, and the inline "Export log…" button. Raw/decoded logs are
      still fully captured — just via the new structured session log (Part B) instead of an
      inline result-screen widget. The `upgrading` step's own "Technical details" disclosure
      (live log tail while running) is unchanged.
- [x] i18n: `result.successMessage` / `result.processFinishedMessage` / `result.finishButton`
      added, `result.successTitle` / `unclearBody` / `reason` / `acknowledgeButton` /
      `playbackFeedbackButton` / `playbackFeedbackRecorded` removed, across all 8 locales
      (`en de es fr it pt zh-Hans zh-Hant`) — key-set diffed identical across all 8 after
      editing. Exact required strings (EN): "The firmware upgrade is completed. Please restart
      the pen and test playback." / "The firmware upgrade process has finished. Please restart
      the pen and test playback."
- [x] **Targeted real-log parsing regression already existed from the prior round**
      (`firmwareUpgrade.test.ts`'s real, redacted P5 log fixture) and was re-checked against
      this round's exact spec: classification combines the actual write-stage evidence + a
      recognized completion signal + `elevation.status === 'completed'` (never a bare "success"
      substring, "block 0", or a `?`-containing fuzzy match alone) — no changes needed here,
      confirmed still passing.
- [x] **Part B — new `src/main/services/firmwareSessionLog.ts`** (pure, no `electron` import,
      fully unit-testable): one JSON file + one raw-bytes sidecar per upgrade attempt under
      `userData/firmwareDiagnostics/sessions/`, written incrementally (write-temp-then-rename,
      every `update()`/`recordStage()`/`finish()` call) so a crash/power-loss loses at most the
      events since the last write, never the whole session — a still-open (`endedAtMs: null`)
      session on disk IS the "interrupted session" record, no separate crash-detection needed.
      All public functions swallow their own errors (logging must never interrupt flashing).
      Bounded: 20-session retention (`pruneOldSessions`, deletes both files of the oldest), 2MB
      raw-log cap per session. Deliberately separate, explicitly-named fields for the three
      claims the user's spec required kept distinct: `toolProcessConfirmedFinished` (=
      `outcome.processTerminationConfirmed`), `successSignalDetected` (= `status === 'success'`),
      and `penFirmwareVersionVerified` (typed as the literal `false` — no read-back mechanism
      exists, so a future accidental `= true` is a compile error, not a silent behavior change).
- [x] Wired into `startFirmwareUpgrade()` (`src/main/ipc/firmware.ts`): a session starts the
      moment `tryBeginFirmwareUpgrade()` succeeds; `onLogUpdate`/`onCodepageDetected` feed the
      raw-byte accumulator and codepage field live (no per-chunk decoding — matches the existing
      "decode the whole accumulated buffer fresh" rule); `recordStage()` calls at
      launch/uac-outcome/first-flashing-output/process-termination/result-classification/
      lock-state-change/recovery-marker-write-or-clear; `finish()` (or, on an exception, the
      catch block's own `finish()`) records the final decoder/fallback/completion-signal/
      exit-code/termination/classification/message-key fields. This also naturally consumed the
      previously get-orphaned `DiagnosticsExportResult`/`redactText` imports flagged after the
      Part A edits — no more unused-import errors.
- [x] **Export**: `exportFirmwareDiagnostics()` (`src/main/ipc/firmware.ts`) — folder-picker
      dialog, then writes the most recent 5 sessions plus the most-recent-interrupted session
      (if not already among them) as `<id>.json` (redacted via the existing `redactText`),
      `<id>.decoded.txt` (decoded via the existing `decodeLogBytes`, then `redactText`'d), and
      `<id>.raw.bin` (kept close to untouched — `redactRawLogBytesForExport` only does a
      best-effort ASCII-OS-username byte scrub, explicitly documented as NOT a general redaction,
      specifically so real encoding problems stay investigable from the true original bytes).
      New IPC channel `firmwareDiagnosticsExport`, preload method
      `exportFirmwareDiagnostics()`, wired into `SupportTab.tsx` inside the SAME existing hidden
      `00000000`-passcode-gated panel as the general diagnostics export (no new access gate) —
      new i18n keys (`diagnostics.firmwareExport{Hint,Button,Saved}`) added to all 8 `settings.json`
      locales, key-set diffed identical.
- [x] **New tests**: `tests/unit/firmwareSessionLog.test.ts` (19 tests — incremental
      persistence, interrupted sessions, raw-byte/encoding preservation across chunked/split
      multi-byte input, the 2MB cap, redaction of both the structured record and best-effort raw
      bytes, the 20-session retention prune, and an end-to-end session→list→read→redact
      snapshot); 3 new tests appended to `firmwareIpc.test.ts` for the real `exportFirmwareDiagnostics`
      IPC handler (driven by a real, simulated `startFirmwareUpgrade` run — never a real vendor
      tool or pen) covering the happy path, a cancelled folder picker, and an interrupted session
      being included in the export. `FirmwareScreen.test.tsx` rewritten for the new result-step
      structure (old playback-feedback/old-acknowledge/inline-export tests removed; new tests for
      the unified success/confirmed-unclear Finish-button UI and the still-distinct failed/
      not-yet-confirmed-terminated states).
- [x] **471 tests pass, 6 skipped, across 44 files**; `typecheck` and `build` both clean.
- [x] Committed, version-bumped to v0.3.15, tagged, and released across all 3 platforms
      (Windows x64, macOS arm64/x64) — all 3 installers + `.sha256` confirmed present.

# Bug fix (post-v0.3.15): "Finish" was quitting the app instead of returning to the wizard

User caught that the "Finish" button on the result screen (added this same round, above) called
`app.quit()` — it should end the wizard run and return to the Prepare step, letting the user reach
the app's actual home via the existing left-side Home navigation, never close the app outright.

- [x] `handleFinish()` (`FirmwareScreen.tsx`): still calls `acknowledgeFirmwareOutcome()` first
      (unchanged — this is the one safety-critical step, releasing any pending lock exactly as
      before), then calls the existing `startOver()` (same reset already used by the "failed"
      outcome's "Start over" button) instead of the removed `finishFirmwareUpgrade()` IPC call.
      Resets this run's temporary wizard UI state (packageInfo/progress/outcome/etc.); never
      touches the saved session diagnostic logs on disk (`firmwareSessionLog.ts` — untouched by
      this file entirely).
- [x] **Removed** the now-fully-redundant `finishFirmwareUpgrade` IPC end-to-end (main process
      function in `firmware.ts`, channel in `ipcChannels.ts`, registration in `ipc/index.ts`,
      preload method, `PonyAbcApi` type entry) — once `app.quit()` was gone, its only remaining
      logic (release any pending lock) was byte-for-byte identical to the `acknowledgeFirmwareOutcome()`
      call `handleFinish()` already makes first; keeping a second, same-effect function around
      would just be dead/confusing code.
- [x] Safety invariants unchanged and re-verified by inspection: Finish is still only rendered
      when `outcome.processTerminationConfirmed && status !== 'failed'`, so it structurally can
      never force-terminate a running tool or release a not-yet-confirmed-terminated lock — this
      button-gating logic itself was not touched.
- [x] No i18n changes needed — the "Finish"/"完成" button label text is unaffected; the diff is
      entirely main-process plumbing removal + one renderer function body change.
- [x] Tests: rewrote the confirmed-unclear Finish test to assert a return to "Prepare your pen"
      instead of a quit-IPC call; added a new success-outcome Finish test asserting the same
      return-to-Prepare behavior AND that a fresh "Next" click lands on a clean Package step
      (no stale `packageInfo`/outcome carried over). **472 tests pass, 6 skipped, across 44
      files**; `typecheck` and `build` both clean. No real firmware flash executed.

# Microsoft Store (MSIX) packaging — v0.3.16 prep

User-approved plan (see `/Users/aiagent/.claude/plans/reflective-jingling-allen.md` for the
full write-up): add a Windows Store distribution channel alongside the existing GitHub
EXE/DMG paths, using the exact Partner Center identity already reserved (`PonyABC.PonyABCDesktop`,
publisher `CN=E476FCF5-1C63-4A56-85B1-DA5D642911B5`, PublisherDisplayName `PonyABC`, Store ID
`9P544XC6B609`). Grounded in official Microsoft Learn docs fetched live this session, not
assumed from training data (Store Policy 7.20, MSIX app package requirements, MSIX desktop-app
virtualization docs) — see the plan file for exact quotes/citations.

- [x] **Build pipeline**: `electron-builder.win-msix.yml` (new, `extends: ./electron-builder.yml`,
      overrides `win.target` to `appx` only — the existing NSIS `.exe` target is untouched).
      Confirmed by reading the installed `electron-builder@25.1.8`'s actual
      `node_modules/app-builder-lib/out/targets/AppxTarget.js` and its `appxmanifest.xml`
      template directly (not just its docs site) that: the CLI target name is `appx`;
      `applicationId` defaults cleanly to `identityName` and passes its validation regex;
      `capabilities` in this installed version is **hardcoded to `runFullTrust` only** in the
      template — there is no code path that could add `allowElevation` even by accident, which
      settles that specific risk without needing a real device test. `package.json`: new
      `dist:win:msix` / `pack:win:msix` scripts alongside the untouched `dist:win`.
      `scripts/checksum.mjs`: now also checksums `.msix` files.
- [x] **CI**: `.github/workflows/build-windows.yml` extended (same job, same `windows-latest`
      runner, existing NSIS steps untouched) to: generate an ephemeral self-signed cert whose
      Subject exactly matches the required `publisher` (never a secret, never committed, scoped
      to `CSC_LINK`/`CSC_KEY_PASSWORD` env vars local to one step), build the MSIX, import that
      same cert into `Cert:\LocalMachine\TrustedPeople`, then **actually run
      `Add-AppxPackage`/`Get-AppxPackage`/`Remove-AppxPackage` against the real output** as a
      build-time correctness gate — not just "packaging exited 0". Uploads `*.msix`+`.sha256`
      as a separate `windows-msix` artifact and attaches both to tagged GitHub Releases, mirroring
      the existing `.exe` pattern. **Not yet actually run** — these changes are local/committed
      to a branch, not yet pushed, pending Benny's go-ahead to push (see final summary).
- [x] **Variant identification**: `identifyAppVariant()` (`src/shared/appVariant.ts`) takes a
      new optional `isWindowsStore` param → `'win-x64-msix'` identifier / new
      `about.variantWinX64Msix` i18n key (added to all 8 locales, key-set parity verified via a
      one-off Node script, not just eyeballed). Sourced from Electron's own `process.windowsStore`
      runtime flag (`src/main/ipc/appInfo.ts`), not a build-time env var — it can't drift out of
      sync with how the app actually launched, unlike a baked-in flag would.
- [x] **Update flow**: Store builds must never be told to install the GitHub `.exe` over
      themselves. `checkForUpdates()` (`src/main/ipc/updates.ts`) now short-circuits to a new
      `{ status: 'store-managed' }` `UpdateCheckResult` variant *before* the GitHub API call
      when `process.windowsStore` is true; `VersionUpdatesTab.tsx` renders a
      "Store handles updates automatically" hint instead of the download button in that case.
      New tests: `tests/unit/updates.test.ts` (mocks `electron`, asserts `fetch` is never called
      in the store-managed branch), plus 3 new `appVariant.test.ts` cases for the new branch.
      **480 tests pass, 6 skipped, across 45 files; typecheck clean** (baseline before this work:
      474/44).
- [x] **AppData-virtualization research finding (settings coexistence) — corrects an
      over-cautious assumption in the approved plan.** The plan assumed a GitHub-EXE install's
      settings wouldn't carry over to a Store install and proposed writing one-time migration
      code. Re-reading Microsoft's own MSIX desktop-apps doc more carefully during implementation
      surfaced a specific documented mechanic that likely makes that migration code unnecessary:
      for `AppData` **file opens** (not directory enumeration), "if [the virtualized copy]
      doesn't exist, the OS will attempt to open the file from the real AppData location... If
      the file is opened from the real AppData location, then no virtualization for that file
      occurs" (going forward). If this holds for `settings.json` specifically, a fresh MSIX
      install's very first read of `<userData>/settings.json` would transparently see (and keep
      using) the real, already-existing GitHub-EXE settings file, with zero app code needed.
      **Deliberately did NOT write speculative migration code for this** — per this project's
      own established standard (see the `copy /b` vs. `copy ..\..\script.ver` lesson above:
      "we verified an adjacent case" is not evidence for a specific one), a documented general
      mechanic is not the same as a verified fact about this exact file/app, and I have no
      Windows host to test it on. Left as an explicit, named item for the real-machine
      verification pass below, with the "write our own migration shim" fallback documented but
      NOT implemented pre-emptively.
- [x] **RESOLVED WITH REAL EVIDENCE (Run 6, 35497737466) — the file-visibility concern does NOT
      materialize.** The "Store package: firmware wizard plumbing probe" CI step's real result:
      ```json
      {
        "userDataPath": "C:\\Users\\runneradmin\\AppData\\Roaming\\ponyabc-desktop",
        "elevation": { "status": "completed", "exitCode": 0 },
        "logFileExisted": true,
        "logContents": "PONYABC_MSIX_PROBE_OK\r\n",
        "logContainsExpectedMarker": true,
        "recoveryMarkerReadBackImmediately": true,
        "stillRunningAfterCompletion": "not-running",
        "errors": []
      }
      ```
      The elevated child process genuinely found and ran `probe-tool.bat` (written by the
      PACKAGED process under `app.getPath('userData')`), and its output was captured back into
      `run.log` and read successfully by the packaged app. This is the exact, real, empirical
      answer to the load-bearing question below — not a guess, not a doc-reading inference.
      **Important remaining nuance, not overclaimed**: this CI run's elevation status was
      `'completed'` without any visible interactive consent step — the `runneradmin` CI service
      account most likely already has silent/auto-approved elevation rights (a common CI-runner
      configuration), which is NOT necessarily representative of a real end-user's UAC-enabled
      desktop. This proves the underlying mechanism and file-visibility question conclusively; it
      does **not** yet prove what a real end-user sees at the actual "Do you want to allow this
      app..." consent dialog — that specific, separate question needed the real-machine notebook
      test. **Update**: since resolved by a real notebook run using
      `store-assets/windows-test-kit/` (the file originally referenced here,
      `windows-test-notebook.md`, was superseded by that fuller kit and has been removed) — see
      the "REAL notebook test result" section further down for what that run confirmed and what
      it didn't (UAC decline specifically is still open).
      Original open-risk description, for the record (what was investigated and now resolved):
      `elevatedRun.ts` writes its scratch files
      (`run.bat`/`run.ps1`/`run.log`/`codepage.txt`) under `app.getPath('userData')` (i.e.
      `firmwareRun`, under Roaming AppData) from inside the PACKAGED process, then elevates them
      via `Start-Process -Verb RunAs`, which spawns a NEW process with **no package identity**
      (this is what lets it avoid needing the restricted `allowElevation` capability — see
      above). But AppData write-virtualization is applied **per accessing process's package
      identity**, not per-file: a non-packaged process reading the identical nominal path may
      resolve to the real (unwritten) AppData location instead of the packaged process's private
      virtualized copy — i.e. the elevated `cmd.exe`/vendor-exe chain could simply fail to find
      `run.bat` at all, breaking the firmware flow outright rather than merely risking extra
      Store review. I could not resolve this conclusively from Microsoft's docs (the exact
      cross-process visibility rule for a file that only exists in the virtualized copy, accessed
      by a process with no package identity, isn't spelled out), and did not want to design a
      brittle, uncertain CI-only probe for it (launching a packaged app with an env var via
      `shell:appsFolder` doesn't reliably inherit a calling PowerShell session's `$env:` vars —
      it goes through shell activation, not direct process inheritance — so a CI "proof" here
      would likely just be testing the CI hack's own reliability, not the real question).
      **Next step (real machine, not CI)**: install the sideload MSIX, run the firmware wizard
      against the existing `PONYABC_TEST_VOLUMES_ROOT`/simulated-pen test hook, and confirm the
      elevated batch actually launches and its log file is readable back by the (packaged) app.
      **If it fails**: the smallest fix is moving `firmwareRun`/`firmwareDownloads`/
      `firmwareRecovery`'s base directory from `app.getPath('userData')` to
      `app.getPath('documents')` (confirmed NOT in Microsoft's virtualized-paths list, unlike
      `Local`/`Roaming`) plus a clearly-named subfolder — NOT implemented pre-emptively, because
      it's an unverified guess at a fix for an unverified problem, and Documents-folder clutter
      is a real UX cost only worth paying if the plain `userData` path is actually proven broken.
- [x] **The real, interactive UAC consent dialog — approval path confirmed; decline path still
      open.** Run 6's CI probe elevation `status: 'completed'` without any visible prompt, most
      likely because the CI service account already has silent/auto-approved elevation — not
      evidence either way for a real end-user's UAC-enabled desktop. **Resolved (partially) by a
      real notebook run** using `store-assets/windows-test-kit/` — approving the prompt once, from
      a confirmed non-administrator session, is now real, demonstrated evidence. Declining the
      prompt, and the interrupted-launch/recovery behavior, were NOT exercised by that run and
      remain open — see the "REAL notebook test result" section further down.
- [x] Pushed to a branch (`msix-store-packaging`, not `main`) once Benny explicitly authorized
      it. The two pre-existing unpushed `main` commits (`2299524` fix + `8c40d24` feat, both
      firmware result-screen work from 2026-09-16) were reviewed via `git show --stat` first per
      Benny's explicit instruction — legitimate, already-tested, self-contained prior work,
      nothing unexpected. They ride along as ancestors of this branch (unavoidable — any branch
      push includes its own history) but `main` itself was never pushed to.

## Correction: real package format is `.appx`, not `.msix` — verified by reading the toolchain's own code

Benny explicitly asked: "state the actual package format produced; do not simply rename an APPX
file to MSIX." Investigating this surfaced a real bug that would have broken the CI pipeline
outright, caught before ever running it for real:

- [x] Read `node_modules/app-builder-lib/out/targets/AppxTarget.js` directly (installed
      `electron-builder@25.1.8`) — confirmed the CLI target name is `appx` (there is no separate
      `msix` target registered in `winPackager.js`'s target-class switch at all in this version),
      it invokes `makeappx.exe` (the classic Appx packaging tool), and the manifest template
      (`appxmanifest.xml` inside the same package) uses only the base
      `foundation/windows10`/`uap`/`desktop`/`rescap` schema namespaces — no MSIX-exclusive
      manifest features (e.g. modification packages) are used or even available here. The real,
      honest package format this toolchain produces is Appx, full stop — "MSIX" is Microsoft's
      later branding for the same underlying format when used for a plain full-trust desktop app
      like this one, not a different, newer container this tool actually builds.
- [x] **Found the actual bug**: `AppxTarget.js`'s `build()` calls
      `packager.expandArtifactBeautyNamePattern(this.options, "appx", arch)` — the second
      positional argument is literally the string `"appx"`, and `${ext}` in any `artifactName`
      template is substituted with EXACTLY that string, always. My original
      `artifactName: ...winx64.${ext}` would have silently produced a file named `...winx64.appx`
      — not `.msix` — meaning the original CI workflow's `Get-ChildItem -Filter '*.msix'` step
      would have found nothing and failed on its very first real run. Caught by reading the
      source before ever pushing, not by a failed CI run.
- [x] **Fix, chosen deliberately over a rename**: renamed everything honestly to `.appx` —
      `electron-builder.win-msix.yml` → `electron-builder.win-appx.yml`, artifactName hardcoded
      to literal `.appx` (not relying on the `${ext}` implementation detail), npm scripts
      `dist:win:appx`/`pack:win:appx`, `checksum.mjs`'s extension filter, the whole CI workflow's
      step names/globs, and README wording. Partner Center's own "App package requirements for
      MSIX app" doc explicitly lists `.appx`/`.appxbundle`/`.appxupload` as directly, equally
      accepted Store submission formats alongside `.msix` — shipping the real `.appx` this
      toolchain produces is correct and honest, not a downgrade, and avoids ever manufacturing a
      `.msix`-named file whose content didn't actually come from MSIX-aware tooling.

## Real CI verification, structured per Benny's request (packaging / installation / launch / functional — kept as separate, distinguishable steps, not one pass/fail blob)

`.github/workflows/build-windows.yml` now has 6 distinct Store-package steps after the
(untouched) NSIS `.exe` steps:

1. **Packaging** — ephemeral self-signed test cert (Subject exactly matching the required
   `publisher`, generated fresh per CI run, never a secret/committed/reused) + `dist:win:appx`.
2. **Packaging verification** — unzips the real built `.appx` (via
   `System.IO.Compression.ZipFile`, not `Expand-Archive`, which doesn't reliably handle every
   Appx block-map layout), reads the REAL `AppxManifest.xml` bytes (prints them in full to the
   log — not a template, not an assumption), and asserts Identity `Name`/`Publisher` and
   `Properties/PublisherDisplayName` match the required Partner Center values **exactly**,
   failing the build with a clear diff if not.
3. **Installation** — real `Add-AppxPackage`, then asserts the *Windows-computed*
   `PackageFamilyName` (a hash of Identity Name + Publisher that only Windows itself computes)
   equals the Partner Center-registered `PonyABC.PonyABCDesktop_f1jemggxjsyxg` exactly — the
   strongest possible proof the identity is really correct, since this isn't a value anything in
   our own config controls or could get "accidentally right."
4. **Launch** — starts the installed package's real `.exe` directly from its
   `Get-AppxPackage`-reported `InstallLocation`, waits 8s, confirms the process is still running
   (not just that `Start-Process` didn't throw), then tree-kills it.
5. **Functional probe (firmware plumbing)** — see below. Deliberately `continue-on-error: true`:
   an inconclusive/timeout result here is real, useful information, not a workflow failure.
6. **Cleanup** — `Remove-AppxPackage`, `if: always()`.

### Firmware wizard plumbing probe — exercises real production code, never a vendor tool or a pen

Benny's instruction was explicit: investigate the packaged/unpackaged elevation path question
with a harmless helper that exercises the ACTUAL elevation/working-dir/log-reading/recovery-
marker code, and do not assume the elevated child lacks package identity — verify it.

- [x] New `src/main/services/msixFirmwarePlumbingProbe.ts` — calls the REAL, unmodified
      `runElevated()` (`elevatedRun.ts`) and `writePendingRun`/`readPendingRun`/`clearPendingRun`/
      `checkStillRunning` (`firmwareRecovery.ts`) against the SAME real directories
      `startFirmwareUpgrade` uses (`<userData>/firmwareRun`, `<userData>/firmwareDownloads/...`,
      `<userData>/firmwareRecovery/pending.json`) — not test-convenient stand-in paths. The only
      thing substituted is the target executable: a two-line generated `probe-tool.bat` (name
      deliberately nothing like a vendor filename) that echoes a fixed marker string and exits 0.
      Never touches `isd_download.exe`/`ufw_maker.exe`/any downloaded vendor content, never
      requires a pen.
- [x] Wired into `src/main/index.ts` behind `PONYABC_MSIX_FIRMWARE_PROBE=1` +
      `PONYABC_MSIX_FIRMWARE_PROBE_OUTPUT=<path>` — runs before any window/IPC handler, writes its
      full JSON result (including the real `RunElevatedResult`, the actual `run.log` contents if
      any, and every step's own success/failure) to the given path, then `app.quit()`s
      immediately. Never runs unless both env vars are explicitly set.
- [x] **This directly tests, rather than assumes, the load-bearing question**: `runElevated`'s own
      generated `run.bat` literally does `"<probeToolPath>" ... > run.log 2>&1` — if the elevated
      (package-identity-stripped-by-`Start-Process -Verb RunAs`, per the ORIGINAL hypothesis) child
      process cannot actually see the packaged parent's `probeToolPath` (written under
      `app.getPath('userData')`), that failure shows up directly and unambiguously in `run.log`
      (a real "not recognized"/"cannot find the file" error) rather than needing a separate
      package-identity-detection mechanism. If the marker string echoes back successfully, the
      concern is empirically resolved regardless of the exact technical reason. Explicitly does
      NOT assume the outcome either way going in — see CI results below once a real run completes.
- [x] 4 new unit tests (`tests/unit/msixFirmwarePlumbingProbe.test.ts`) — real filesystem I/O
      against a temp dir standing in for `userData` (only `electron.app.getPath` is mocked), real
      (unmocked) `runElevated`/`writePendingRun`/etc. calls. On this non-Windows dev machine,
      `runElevated` itself correctly short-circuits to `unsupported-platform` (its own existing,
      already-tested platform check) — confirms the probe's plumbing (path construction, stale-run
      cleanup, recovery-marker round trip) without needing Windows, while the actual elevation
      question stays honestly deferred to the real Windows CI run. **484 tests pass, 6 skipped,
      across 46 files; typecheck clean.**
- [ ] **Real CI run results — pending**, this is the very next step after this commit is pushed.
      Will report: whether packaging/manifest/identity/install/launch all pass as designed, and
      the actual probe JSON (or an honest "timed out — needs the interactive real-machine test"
      if the UAC prompt blocks non-interactively, which is itself expected and useful to confirm).

## First real CI run: caught a self-inflicted bug before packaging ever ran

Pushed `msix-store-packaging` (Benny explicitly authorized), checked the 2 pre-existing unpushed
`main` commits' contents first as instructed (legitimate prior firmware-UI work, nothing
unexpected), then dispatched the workflow manually via `gh workflow run build-windows.yml --ref
msix-store-packaging` (a plain branch push does not trigger it — only `main`/tags do). Confirmed
the dispatch genuinely used the branch's updated workflow content (new step names showed up in
`gh run view`), not a stale `main` copy.

- [x] **Run 1 (35496447966) failed at the ordinary `npm test` step** — before packaging ever
      started. Root cause: `tests/unit/msixFirmwarePlumbingProbe.test.ts` called the real,
      unmocked `runMsixFirmwarePlumbingProbe()` (hence the real `runElevated()`) unconditionally.
      On this Mac dev sandbox that's harmless (`runElevated` short-circuits to
      `unsupported-platform` instantly), but `npm test` also runs for real on `windows-latest` in
      this very workflow — there, it genuinely attempted `Start-Process -Verb RunAs`, which
      blocked past vitest's default 5000ms per-test timeout in a non-interactive session,
      failing the whole job. This exact class of mistake already had a documented fix in this
      repo (`elevatedRun.windows-smoke.test.ts`'s own header explains it) — I should have checked
      for that convention before writing a new test that touches the same real mechanism, and
      didn't.
- [x] **Fix, matching the existing convention exactly**: split into two files.
      `msixFirmwarePlumbingProbe.test.ts` now mocks `runElevated` (via `vi.mock` with
      `importOriginal`, keeping every OTHER function — `writePendingRun`/`readPendingRun`/
      `clearPendingRun`/`checkStillRunning` — real) so it stays fast and safe on every platform,
      including real Windows CI; it simulates exactly what a real elevated run writes to
      `run.log` so downstream assertions (marker content, error paths on a `declined`/non-
      completed outcome) stay meaningful. The real, unmocked mechanism moved to a new
      `msixFirmwarePlumbingProbe.windows-smoke.test.ts`, gated behind the SAME
      `PONYABC_RUN_ELEVATION_SMOKE=1` + Windows-only guard as `elevatedRun.windows-smoke.test.ts`
      (same underlying mechanism, reusing the same opt-in variable is correct, not just
      convenient), added as a second step in `.github/workflows/firmware-elevation-smoke.yml`
      (manual-dispatch-only, never runs on push/tag/the main build workflow), and bumped that
      workflow's timeout from 8 to 15 minutes to cover both files' full budgets.
- [x] **484 → 486 tests pass, 7 skipped (up from 6 — the new smoke file's skip placeholder),
      across 47 files; typecheck clean; full local `npm test` run completes in ~2.7s** (confirms
      the fast file no longer risks a real elevation attempt on any platform).
- [x] Committed and pushed the fix to `msix-store-packaging`; re-dispatched the workflow.

## Run 2 (35496829480): npm test now passes; packaging itself failed on a runner/tooling issue

Real progress — `typecheck`/`test`/`dist:win` (NSIS) all passed this time, confirming the test
fix worked. The NEW Store-package packaging step failed with:

```
SignTool Error: A required function is not present.
```

- [x] **Real, verified cause**: electron-builder's own bundled `signtool.exe` (from its
      `winCodeSign-2.6.0` vendor package, cached at
      `AppData\Local\electron-builder\Cache\winCodeSign\...\windows-10\x64\signtool.exe`) is
      incompatible with the current `windows-latest` runner image — a known class of issue
      (GitHub periodically bumps the underlying Windows Server image; an old vendored signtool
      binary can start failing against newer OS DLL export sets). This has nothing to do with the
      appx target, the manifest, or the identity config — confirmed by reading the actual error
      (a generic SignTool/CryptoAPI failure, thrown before any manifest/identity code runs at
      all).
- [x] **Fix**: read `node_modules/app-builder-lib/out/codeSign/windowsSignToolManager.js`
      directly — `getToolPath()` checks `process.env.SIGNTOOL_PATH` FIRST, before falling back to
      the vendored binary. `build-windows.yml`'s packaging step now locates the real Windows SDK
      `signtool.exe` already present on the runner (via Visual Studio Build Tools, under
      `C:\Program Files (x86)\Windows Kits\10\bin\*\x64\signtool.exe`) and sets `SIGNTOOL_PATH` to
      it before calling `npm run dist:win:appx`. This only affects local/CI test-signing (the
      real Store submission needs no certificate/signtool at all — Microsoft re-signs on
      ingestion).
- [x] Pushed, re-dispatched.

## Run 3 (35497047418): npm test failed again — but a real fs/AV timing issue, not the same bug

`typecheck`/`dist:win` etc. unaffected; `npm test` failed again, but tellingly only ONE test in
`msixFirmwarePlumbingProbe.test.ts` (the fast, mocked file) timed out at vitest's 5000ms default,
while the other 4 tests in that SAME file — calling the exact same mocked
`runMsixFirmwarePlumbingProbe()` — passed in ~400-450ms each. That pattern rules out "the mock
isn't working" (it clearly is, for 4/5 tests) and points at a one-time cold-start cost instead.

- [x] **Real, verified cause**: this repo's own `elevatedRun.windows-smoke.test.ts` already
      documents real, multi-second Windows filesystem latency around fresh `.bat` files on
      `windows-latest` (an `EBUSY` on cleanup there, attributed to antivirus real-time scanning).
      My probe module also writes a `.bat` file (`probe-tool.bat`) on every call; whichever test
      happens to run first in the file pays that one-time cost and can exceed vitest's 5s
      default, while the rest (same file, same mock, already "warmed up") comfortably don't.
- [x] **Fix**: gave all 5 tests in the fast file an explicit 15s timeout (`WINDOWS_FS_TIMEOUT_MS`)
      — the same kind of fix this repo's existing smoke test already uses for its own Windows
      timing surprises, not a new pattern. Confirmed locally: still passes, still fast (~2.6s
      total for the whole suite on this dev machine — the 15s ceiling is headroom for Windows
      CI's slower first-touch cost, not a new baseline).
- [x] Pushed, re-dispatched.

## Run 4 (35497255632): npm test passed; packaging failed on a SECOND, different signtool issue

Confirms the fs-timeout fix worked (`npm test` green). The `SIGNTOOL_PATH` fix from Run 2 also
worked — the packaging step now genuinely uses the Windows SDK's own signtool.exe (log showed it
resolving to `C:\Program Files (x86)\Windows Kits\10\bin\10.0.26100.0\x64\signtool.exe`) — but hit
a NEW error signing the inner `PonyABC Desktop.exe` before appx wrapping:

```
SignTool Error: No file digest algorithm specified. Please specify the digest algorithm with the
/fd flag.
```

- [x] **Real, verified cause**: read `windowsSignToolManager.js`'s `computeSignToolArgs()`
      directly. electron-builder dual-signs each inner `.exe` with sha1 THEN sha256 by default
      (`hashes = ["sha1", "sha256"]` when `signingHashAlgorithms` isn't set) — and for the sha1
      pass specifically, its own code deliberately omits `/fd` (`if (!isWin || options.hash !==
      "sha1") { args.push(isWin ? "/fd" : "-h", options.hash); ... }`), relying on signtool
      historically defaulting to SHA1 when unspecified. The Windows SDK's current signtool.exe
      (10.0.26100.0) no longer allows that omission at all — a second, independent incompatibility
      from Run 2's vendored-binary one, this time in electron-builder's own default signing
      behavior against a stricter modern signtool, not the tool location.
- [x] **Fix**: `electron-builder.win-appx.yml`'s `win:` block now sets `signingHashAlgorithms:
      [sha256]`, skipping the broken sha1 pass entirely — correct anyway, since this package only
      ever targets Windows 10+, with no legacy-OS reason to keep sha1. Scoped to this file only —
      the base `electron-builder.yml` (NSIS `.exe`) and both mac configs are untouched.
- [x] Pushed, re-dispatched.

## Run 5 (35497465010): packaging, manifest identity, AND install/PackageFamilyName all passed for real

Genuine milestone — the first three verification layers all passed on a real Windows runner:

- [x] **Packaging**: `.appx` built successfully with both signtool fixes.
- [x] **Manifest identity verification**: the REAL `AppxManifest.xml` inside the built package
      carries `Identity Name='PonyABC.PonyABCDesktop'`, `Publisher='CN=E476FCF5-1C63-4A56-85B1-
      DA5D642911B5'`, `PublisherDisplayName='PonyABC'` — all confirmed byte-for-byte against
      Partner Center's required values, not assumed from the config file.
- [x] **Installation + the strongest identity proof available**: `Add-AppxPackage` succeeded, and
      Windows' own real, independently-computed `PackageFamilyName` came back as
      `PonyABC.PonyABCDesktop_f1jemggxjsyxg` — an EXACT match to the Partner Center-registered
      value. This is Windows itself confirming the identity is right, not our own config
      reporting back what we told it.

**Launch verification then failed** — but on a CI-script bug, not an app problem:
`Get-ChildItem -Path $installed.InstallLocation -Filter '*.exe'` found nothing (confirmed by the
error message itself showing the correct install path,
`...\WindowsApps\PonyABC.PonyABCDesktop_0.3.15.0_x64__f1jemggxjsyxg`, which also independently
re-confirms the exact same PackageFamilyName suffix). Root cause: `WindowsApps`'s restrictive
ACLs block a plain directory listing there, even for an admin account, without `-Force` — a
known, documented Windows behavior, not a broken package.

- [x] **Fix**: both the launch-verification and firmware-probe steps now resolve the real
      executable path by reading the `Executable` attribute straight out of the INSTALLED
      `AppxManifest.xml` (the same source of truth Windows itself uses to launch the app), instead
      of listing the directory. More robust than a filesystem guess either way.
- [x] Pushed, re-dispatched.

## Run 6 (35497737466): FULLY GREEN — packaging, identity, install, launch, and the firmware probe all passed

The whole job passed for the first time. Summary of what's now real, verified evidence (not
assumption) as of this run:

- **Packaging**: `PonyABC-Desktop-v0.3.15-winx64.appx` built, 115.48 MB.
- **Manifest identity**: `Name='PonyABC.PonyABCDesktop'`, `Publisher='CN=E476FCF5-1C63-4A56-85B1-
  DA5D642911B5'`, `PublisherDisplayName='PonyABC'` — read from inside the real built package,
  matches Partner Center exactly.
- **Install + strongest identity proof**: real, Windows-computed `PackageFamilyName` =
  `PonyABC.PonyABCDesktop_f1jemggxjsyxg` — matches the Partner Center-registered value exactly.
- **Launch**: `PonyABC Desktop.exe` (PID 5696) confirmed running 8s after launch from the
  installed package.
- **Firmware plumbing probe**: elevation completed, the elevated child found and ran the
  packaged parent's file under `app.getPath('userData')`, log captured and read back correctly,
  recovery marker round-tripped correctly. See the resolved risk entry above for the full result
  and the one remaining, separate, real-human-only question (the actual interactive UAC dialog).
- **Artifacts produced**: `windows-installer` (NSIS `.exe`, unaffected throughout) and
  `windows-appx` (the new Store package) — both downloadable from this run's Actions page.
- Both macOS `.dmg` build workflows (`build-mac.yml`) were never touched by any of this work.

## Complete Windows test kit (`store-assets/windows-test-kit/`) — per Benny's detailed review of the first draft

Benny's follow-up review caught a real, important flaw in my first chat-only instructions: they
had the tester run the firmware probe from the SAME Administrator PowerShell window used for
install — which would make the UAC test meaningless (an already-elevated parent's child process
elevation requests get silently auto-approved, exactly why CI's own probe run never showed a
prompt). Built a proper, self-contained kit instead:

- [x] `1-install.ps1` (run as Administrator): discovers the `.appx` by pattern (not a hardcoded
      version string, so it keeps working across future releases), verifies its SHA-256, reads
      the `.cer`'s exact certificate **thumbprint** (not just Subject — multiple certs can share
      a Subject), checks whether that exact thumbprint is already trusted before importing
      (never overwrites/duplicates), installs, verifies the real `PackageFamilyName`, and records
      everything (including whether IT imported the cert vs. found it already trusted) to
      `test-kit-state.json` for cleanup to use later.
- [x] `2-run-firmware-probe.ps1` (must run from a NORMAL, non-administrator session — checks for
      and refuses to run elevated, with a clear explanation why): resolves the real exe from the
      installed `AppxManifest.xml`, launches it with the probe env vars wrapped in `try/finally`
      so they're cleared even if something throws, and confirms the LAUNCHED PROCESS itself
      carries real package identity via the documented Win32 `GetPackageFullName` API (succeeds
      only for a process with package identity, fails with `APPMODEL_ERROR_NO_PACKAGE` otherwise)
      — not just "it's installed under WindowsApps." Takes an optional `-DelaySeconds` param.
- [x] **New, small, deliberate production-adjacent change**: `msixFirmwarePlumbingProbe.ts` gained
      an optional `PONYABC_MSIX_PROBE_DELAY_SECONDS` (1-60, clamped) env var that inserts a real
      `ping -n <n> 127.0.0.1 >nul` pause into the harmless stand-in script before it prints its
      marker — the original script finished in well under a second, far too fast for a human to
      deliberately interrupt mid-flight to test the crash-recovery behavior. 4 new unit tests
      (delay present/absent/clamped) — 488 tests pass, 7 skipped, 47 files; typecheck clean.
- [x] `3-cleanup.ps1` (Administrator): removes the package, and removes the certificate thumbprint
      ONLY if `test-kit-state.json` says this kit imported it — never a pre-existing cert that
      happened to share the same Subject, never touching trust that existed before.
- [x] **Precise recovery-behavior guidance, not "does it reopen ok"**: read the actual
      `FirmwareScreen.tsx`/`firmware.ts` recovery code and the real English UI text
      (`recovery.title`/`stillRunningBody`/`unknownBody` in `en/firmware.json`) rather than
      guessing. The kit's README documents two genuinely different, both-correct cases: (A)
      interrupted before approving UAC → nothing ever ran → correctly auto-clears silently, new
      attempt works immediately; (B) interrupted while the (now-delayable) stand-in script is
      still genuinely running → must show the real blocking "Previous upgrade not confirmed
      finished" screen and refuse a new firmware attempt or BOOK/DIY pen write until resolved —
      and explicitly flags that an uncertain state getting silently cleared instead would be a
      real bug, not a pass.
- [x] **CI now runs the ACTUAL delivered scripts, not a parallel reimplementation**: the
      packaging job copies `store-assets/windows-test-kit/*.ps1` + `README.md` into `release/`,
      runs a real PowerShell AST parse (`[System.Management.Automation.Language.Parser]::ParseFile`)
      on all 3 scripts as a syntax gate, then the installation step runs the real `1-install.ps1`
      (asserting `certImportedByUs=true` and the correct `PackageFamilyName` in its own state
      file) and the cleanup step runs the real `3-cleanup.ps1` (asserting the package is gone and
      that exact thumbprint is removed) — so a green CI run is real evidence the tester's exact
      scripts work end-to-end, not just that installation is possible in general via different
      inline CI code. The `windows-appx` artifact now bundles the appx/checksum/cert together
      with the 3 scripts and README in one download.
- [x] Pushed, re-dispatched.

## Run 8 (35557075347): running the real scripts caught 2 more real bugs, before any tester saw them

Exactly the value of "run the actual delivered scripts in CI" rather than trusting them by
inspection: `1-install.ps1` printed every success message correctly (checksum OK, identity
verified, "DONE") — and CI's wrapper still reported it as FAILED.

- [x] **Bug 1 — `$LASTEXITCODE` gotcha**: PowerShell cmdlets (`Add-AppxPackage`,
      `Import-Certificate`, `Get-FileHash`, ...) never set `$LASTEXITCODE` themselves — only
      native `.exe` calls or an explicit `exit N` do. Neither script had an explicit `exit 0` on
      its success path, so `$LASTEXITCODE` stayed `$null` afterward, and `$null -ne 0` evaluates
      to `$true` in PowerShell — my own CI wrapper's `if ($LASTEXITCODE -ne 0) { throw ... }`
      fired on a script that had done everything right. **Fix**: explicit `exit 0` added at the
      end of both `1-install.ps1` and `3-cleanup.ps1`, matching the explicit `exit 1` already used
      on every failure path.
- [x] **Bug 2 — double cert trust masked the real scenario**: the packaging step's own leftover
      `Import-Certificate` call (a holdover from before `1-install.ps1` existed) trusted the cert
      BEFORE `1-install.ps1` ever ran, so its "already trusted?" check always found `true` —
      meaning CI could never actually exercise or prove the fresh-machine `certImportedByUs=true`
      import path a real tester hits. **Fix**: removed that now-redundant import from the
      packaging step entirely — `1-install.ps1` is the only thing that imports/trusts the cert
      now, in CI and for a real tester alike.
- [x] Pushed, re-dispatched.

## Run 9 (35557379008): the exit-code fix worked; a third real bug surfaced right behind it

`1-install.ps1`'s own log now showed every step succeeding, INCLUDING "State recorded to
test-kit-state.json" — and the wrapper's very next line, `Test-Path 'release\test-kit-state.json'`,
still reported it missing.

- [x] **Bug 3 — a leaked working-directory change**: `1-install.ps1` deliberately does
      `Set-Location $scriptDir` near the top (so it works correctly regardless of the caller's
      current directory — harmless/a no-op for a real tester, who has already `cd`'d into the
      extracted folder per the README before running it). But PowerShell's current directory is
      **process-wide**, not scoped to the called script — calling it via `& '.\release\
      1-install.ps1'` let that `Set-Location` change leak into the REST of the CI wrapper step,
      so its own subsequent `release\...`-relative paths were now looking one `release\` too
      deep. This only affects a CI wrapper calling the script from a different starting
      directory than the script itself lives in — never a real tester following the README.
      **Fix**: wrapped the invocation in `Push-Location 'release'` / `Pop-Location` so the
      wrapper's own working directory is restored regardless of what the called script does to
      it — the standard, correct PowerShell pattern for exactly this situation.
- [x] Pushed, re-dispatched — run 35557679933 went fully green: syntax check, packaging, manifest
      identity, `1-install.ps1` end-to-end (checksum, thumbprint import, install, identity), real
      launch, firmware probe, and `3-cleanup.ps1` end-to-end (uninstall + exact-thumbprint
      removal) all passed for real on a Windows CI runner.

## REAL notebook test result (Benny's own Windows machine) — scope precisely as reported, not overclaimed

- [x] **What this run actually proves**: `1-install.ps1` matched checksum and `PackageFamilyName`
      for real. `2-run-firmware-probe.ps1`, run from a **confirmed non-administrator session**,
      returned `elevation.status: completed`, `exitCode: 0`, `logContainsExpectedMarker: true`,
      `recoveryMarkerReadBackImmediately: true`, `stillRunningAfterCompletion: not-running`,
      `errors: []`. `3-cleanup.ps1` removed the package and the exact certificate thumbprint this
      kit itself imported.
- [x] **What this run does NOT prove, and must not be conflated with**: this is a real test of the
      harmless elevation/logging mechanism from a genuine non-admin launch — not a real firmware
      flash, and not a complete functional test of the app. **UAC cancellation** (clicking "No")
      and **interrupted-launch recovery behavior** were not exercised by this run and remain
      separate, not-yet-demonstrated checks (both now have explicit steps in the kit's README).

### Bug found from the real output: `GetPackageFullName` result was silently truncated to "P"

Benny's own review of the actual printed output ("Package identity CONFIRMED for the running
process: P") caught this — not something I'd have found from code inspection alone.

- [x] **Real, verified root cause**: the `Add-Type`-declared P/Invoke signature for
      `GetPackageFullName` had no explicit `CharSet`, so .NET defaulted the `StringBuilder`
      parameter to `CharSet.Ansi`. The real Win32 function returns UTF-16 (`PWSTR`) text — for a
      name starting with "P" (UTF-16LE bytes `0x50 0x00`), ANSI-reinterpreting those bytes reads
      `'P'` then immediately hits the `0x00` as a string terminator, truncating everything after
      the first character. This is exactly what the printed output showed.
- [x] **Fix**: added `CharSet = System.Runtime.InteropServices.CharSet.Unicode` to the `DllImport`
      declaration.
- [x] **Also fixed, per Benny's explicit ask**: the script previously treated "API call returned
      success" (a non-null string) as sufficient proof of identity. Now it compares the FULL
      returned string against `$installed.PackageFullName` (already known from `Get-AppxPackage`
      earlier in the script) and reports a clear MISMATCH in red if they differ, rather than
      treating any nonempty result as confirmation.

### README corrections

- [x] **Unblock-File, not execution policy**: added an explicit step (individually unblocking
      each of the 3 downloaded scripts by name via `Unblock-File`, before anything else runs) plus
      a technical-details explanation of the Mark-of-the-Web/Zone.Identifier mechanism and why a
      global `Set-ExecutionPolicy` change would be broader and more persistent than this task
      needs. Never suggests touching execution policy at all.
- [x] **Stale URL/checksum fixed structurally, not just for today**: the README previously
      hardcoded one specific past run's URL and a specific checksum value — both go stale the
      moment CI runs again (a fresh ephemeral build every time). Replaced with a link to the
      *workflow's runs list* (always current) plus a dated reference to the run this exact kit
      version was verified against; the checksum table entry now points to the accompanying
      `.appx.sha256` file (which travels with the download and is checked automatically by
      `1-install.ps1`) instead of a value that would immediately go stale.
- [x] Not re-run through the full interactive notebook test for this round, per Benny's
      instruction not to repeat already-passed testing — CI's syntax-check step is sufficient
      verification for a P/Invoke marshaling fix and documentation-only changes; the human-only
      parts (UAC decline, interrupted recovery) remain open items for whenever Benny next has
      time, not blockers.

## Explicitly deferred, per Benny's instruction: do not move firmware paths to Documents pre-emptively

Benny confirmed: do not pre-emptively move firmware files to `Documents`; if the current
`userData`-based paths are shown to actually fail (via the probe above or the real-machine test),
implement and test the smallest suitable fix THEN, accounting for permissions and recovery. No
speculative path change has been made — `elevatedRun`/`firmwareRecovery`/`firmware.ts` are
byte-for-byte unchanged from before this MSIX work except for what the probe module calls
directly (which calls the same public functions, not modified copies).

## Business details finalized + audience framing corrected (Benny's final input)

- [x] Benny provided the confirmed legal company details (MACROKINETIC MEDIATECH LIMITED, company
      number 16420643, registered office at 128 City Road London EC1V 2NX, correspondence address
      at 34 Redbourne Avenue London N3 2BS — explicitly NOT the registered office). Filled into
      `src/renderer/i18n/locales/en/settings.json`'s `legal.privacy.companyLine` (previously "to be
      confirmed"), the submission-materials privacy notice, and the Category/support table —
      always keeping the two addresses distinctly labeled, never conflated. The two OTHER,
      unrelated "to be confirmed" notices in that same file (website registration-data retention
      period; Terms of Use publication) were left untouched — genuinely still missing, no facts
      given for them. 488 tests pass (including the existing `SettingsScreen.test.tsx` case that
      specifically checks "to be confirmed" still appears for the still-unconfirmed items),
      typecheck clean. Store manifest identity (`PonyABC.PonyABCDesktop` / `PonyABC` display name)
      deliberately untouched, per Benny's explicit instruction.
- [x] **Corrected a real framing mistake from an earlier round**: Benny clarified the app's actual
      audience — parents/teachers/school staff/business users managing pens, NOT children
      operating the app directly, and NOT a game. My earlier category recommendation had literally
      said "the app's target use case is a children's talking-pen companion," which is exactly the
      wrong framing. Rewrote the Store description, short description/tagline, category
      recommendation (now **Utilities & tools**, not Education — the app manages a device, it
      doesn't deliver learning directly), certification notes, and age-rating section (added an
      explicit "Suitable for all ages ≠ an official assigned rating" disclaimer, and a
      target-audience row) throughout `store-assets/submission-materials.md` and the Claude Docs
      artifact to reflect this consistently.

## Complete privacy notice, real IARC mapping, and CI screenshot capture

- [x] **Investigated real network/logging facts before writing the privacy notice** (not
      assumed): grepped every hardcoded host the desktop app's main process ever contacts
      (`register.ponyabc.uk`, `api.github.com`, `github.com` — exhaustive, confirmed via
      `grep -rhoE 'https?://...' src/main`). Checked `ponyabc-web/wrangler.jsonc`
      (`observability.enabled: true` — Cloudflare's own platform-level request logging is on for
      the backend) and `ponyabc-web/src/lib/ip.ts` (confirms IP addresses are hashed with a salt,
      never stored raw, and — checked via a repo-wide grep for callers — this hashing applies
      ONLY to the website's warranty-registration endpoint, never the desktop app's own BOOK/
      firmware/download requests, which carry no personal identifier at all). Looked up
      Cloudflare's own documented default Workers Logs retention (3 days Free / 7 days Paid) but
      explicitly did NOT state which applies to this deployment, since that's an account-level
      fact I can't see from the codebase — flagged as an open item instead of guessed.
- [x] **Full privacy notice saved as its own file**: `store-assets/privacy-notice-desktop.md` —
      complete, not a chat summary. Distinguishes "what our application code sends" from "what
      Cloudflare/GitHub infrastructure may separately retain," explains local recordings/file
      paths/diagnostic logs/retention/opt-in support exports accurately, gives full rights/contact
      info, and deliberately avoids the blanket "no personal information is collected" claim,
      explaining exactly why. Intended URL `https://register.ponyabc.uk/privacy/desktop` recorded;
      existing `/privacy` page explicitly not modified. Page itself NOT yet implemented in
      `ponyabc-web` — that repo has substantial unrelated in-progress changes on disk, and Benny's
      own instruction was to review wording first.
- [x] **Age rating rewritten from "None for all" to real IARC category mapping** — Violence, Fear/
      horror, Sexual content, Language, Controlled substances, Gambling, Users interact, Shares
      user-generated content (explicitly split into the DIY-recordings-are-local case vs. the
      BOOK-content-is-curated-not-user-generated case — never conflated), Shares personal info,
      Shares location, Unrestricted internet access, Digital purchases — each with the real
      question intent and case-specific reasoning, not a single blanket answer. Explicit note that
      Partner Center's actual on-screen wording is interactive/adapts to category and couldn't be
      quoted verbatim without live access — mapped to IARC's own public category structure instead
      of inventing exact UI text.
- [x] **CI now captures real Windows screenshots**: new step in `build-windows.yml`, right after
      launch verification, runs the same platform-agnostic `scripts/capture-screenshots.mjs`
      (already used for the macOS captures) against the installed package's real resolved exe,
      uploads all 5 as a `windows-screenshots` artifact. This replaces the 2 remaining
      macOS-placeholder gaps (Firmware, Settings/About) with genuine native Windows captures, and
      refreshes the other 3 with real Windows chrome too.
- [ ] Triggered a fresh CI run from the current HEAD (includes the companyLine fix and all
      submission-content commits) — this run also serves as "build the final Store package from
      the intended final commit" per Benny's request. Result, exact filename/version/commit/
      checksum, and manifest identity re-confirmation pending below.
