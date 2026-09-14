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
