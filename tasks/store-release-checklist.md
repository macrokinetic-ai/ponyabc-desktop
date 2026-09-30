# Releases: what gets published, where, and when

**The rule, owner decision 2026-09-30.** A version number becomes a GitHub Release in two
stages, and the second one waits for Microsoft.

| Stage | What exists | Marked |
|---|---|---|
| Testing | `vX.Y.Z-rcN` pre-release, one per test build the owner is asked to try | **Pre-release**, never Latest |
| In the Store | `vX.Y.Z` release, created **only after Microsoft Store approval** | Latest |

**A final `vX.Y.Z` Release is never created before the Store has approved that version.** The
reason is that the tag becomes the thing people point at: if it exists while the Store still has
the previous version, the newest link in the repository is for software nobody can install, and
a tester cannot tell which build the customers have. Until approval, the newest thing on the
Releases page is a pre-release, which reads as exactly what it is.

Nothing is ever submitted to Partner Center from here. Submission is a person, signed in, by
hand.

## Publishing a test build (rcN)

1. Push to `release/X.Y.Z` and wait for **Build Windows EXE + Store package** to go green.
   Dispatch it with the `rc` input set to the candidate number — `rc2`, `rc3` — so the build
   stamps itself. The app then shows `0.3.17 (rc2, <commit>)` in **Settings → Version**, and
   the Store build still shows a plain `0.3.17`.
2. Download the run's `windows-installer` artifact. It holds three files:
   the `.exe`, its `.sha256` and `READ-ME-FIRST.txt`.
3. Check the checksum locally (`shasum -a 256 -c *.sha256`) before publishing it to anyone.
4. Create the pre-release on the exact commit the build came from:

   ```
   gh release create vX.Y.Z-rcN --target <full commit sha> \
     --title "vX.Y.Z-rcN — test build" --notes-file notes.md \
     --prerelease --latest=false \
     PonyABC-Desktop-*.exe PonyABC-Desktop-*.exe.sha256 READ-ME-FIRST.txt
   ```

5. The notes say, in plain UK English: **Test build — not for customers**, what to download,
   what Windows will warn and which two words to click, what is new for a tester, and what to
   look at. Never a changelog of commits.

## Publishing a Store version (vX.Y.Z)

Only once Partner Center reports the submission as **published**:

1. Tag the exact commit that was submitted, if it is not tagged already.
2. `gh release create vX.Y.Z --verify-tag --latest`, titled `vX.Y.Z — Microsoft Store version`.
3. Attach the archived `.appx` and its `.sha256` from `store-assets/` — the same bytes that
   were submitted, so a later build can be compared against what customers actually have.
4. The notes say plainly that customers should install from the Store, and that the attachment
   is an archive.
5. Update `tasks/PM-STATUS.md`: published version, source commit, provenance.

## What is on the Releases page today

| Release | What it is |
|---|---|
| `v0.3.16` | The Microsoft Store version, live since 2026-09-28. Latest. Archive of the submitted `.appx`. |
| `v0.3.17-rc1` | The first 0.3.17 test build, from `69e4412`. Pre-release. Predates the build stamp, so it shows a plain `0.3.17` in Settings. |

`v0.3.17` itself does not exist yet, and must not until the Store has approved 0.3.17.
