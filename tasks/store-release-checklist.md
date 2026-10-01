# Releases: what gets published, where, and when

## Two builds, and only one of them is ever submitted (owner, 2026-09-30)

Every commit produces two Windows builds:

| | |
|---|---|
| **Store build** — `PonyABC-Desktop-vX.Y.Z-winx64.exe` and the `.appx` | The **only** build ever submitted to the Microsoft Store. No testing mode, no support tools, no developer switches — excluded when the bundle is built, not hidden at run time. |
| **Internal build** — `PonyABC-Desktop-Internal-vX.Y.Z-winx64.exe` | The same code plus testing mode and the support tools. Its own name, its own application id, its own installer, and a permanent **INTERNAL TEST BUILD** banner. Installs beside the Store app. |

**Never submit the Internal build.** It cannot be submitted by accident — CI fails if an
internal package carries the Store identity — but the rule is written here because a check that
nobody understands is a check somebody will eventually route around.

`tests/unit/storeBuildHasNoDevPaths.test.ts` builds a Store bundle and reads it, so "the Store
build contains none of it" is a fact about the artefact rather than an intention.

## The record rule (owner, 2026-09-30)

**Every version is stored on GitHub as the permanent record. Nothing important may live only on
the Mac mini.** GitHub stays private; the Microsoft Store is the only public channel.

A version's Release carries **all** of it:

| | |
|---|---|
| `…-winx64.exe` + `.sha256` | the installer a tester runs |
| `…-winx64.appx` + `.sha256` | the Store package built from the same commit |
| `READ-ME-FIRST.txt` | install steps in plain English |
| `PonyABC-Desktop-User-Guide-*.pdf` | the parent manual, EN + 繁體中文 |
| `PonyABC-Quick-Start-A4-Fold-*.pdf` | the box quick start, both languages |
| `whats-new-<version>.md`, `store-listing-<version>.md` | the Store text for that version |
| release notes | what it is, how to install it, what to look at |

**Binaries are Release assets and never enter git history.** A repository that has swallowed a
100 MB package carries it in every clone for ever.

Dispatching **Build Windows EXE + Store package** with an `rc` input does all of this by itself:
it builds, checks, and creates or updates `v<version>-<rc>` with every asset above. The manual
PDFs and the Store text come from the repository, where they are versioned with the code.

Records that are not a version — the vendor firmware packages, the SD-card image, the reports —
have their own homes, listed in `macrokinetic-ai/ponyabc-reports`.


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
   stamps itself. A candidate number is spent once it publishes a Release: a build that fails
   before publishing has not used its number, and the same one is dispatched again.

   The stamp is checked twice, and the second check is the one that matters. Each installer's
   SHA-256 is recorded when it is built, and compared again immediately before publishing —
   because `release/` is scratch space that later packaging steps write to, and rc4 shipped an
   installer that a later step had rebuilt on top of the checked one. The app then shows `0.3.17 (rc2, <commit>)` in **Settings → Version**, and
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

## Submitting to the Microsoft Store, step by step (owner does this by hand)

Nothing automated ever touches Partner Center. This is the order to do it in, with the exact
field names as they appear.

Everything you need is in one folder, also attached to the GitHub pre-release
**`v0.3.17-store-candidate`**:

```
AI-Reports/store-submission-0.3.17/
  01-package/      the .appx and its .sha256
  02-store-listing-0.3.17.md     description, short description, features, search terms × 8 languages
  03-screenshots/  5 screens × English and 繁體中文
  04-notes-for-certification.md
  05-whats-new-0.3.17.md         × 8 languages
```

### Before you start

1. Check the package is the one you mean to send. In PowerShell, in `01-package/`:
   `Get-FileHash .\PonyABC-Desktop-v0.3.17-winx64.appx -Algorithm SHA256`
   It must match the `.sha256` file beside it. If it does not, do not upload it.

### In Partner Center

2. **Apps and games → PonyABC Desktop → Start new submission.** If a submission is already open
   and not yet submitted, use that one rather than starting another.

3. **Packages.** Drag in `PonyABC-Desktop-v0.3.17-winx64.appx`. Wait for it to finish validating
   before moving on. It should show **0.3.17.0** and **x64**. The previous package (0.3.16.0) can
   stay; the Store serves the newest a device can run.

4. **Pricing and availability.** Nothing to change. Do not alter markets or visibility.

5. **Properties.** Nothing to change. Category, age rating and the privacy policy URL are all as
   they were — this release does not change any of them.

6. **Store listings → English (United Kingdom).** Replace these four, from
   `02-store-listing-0.3.17.md`:
   - **Description**
   - **Short description**
   - **Product features** — one per line, 15 of them
   - **Search terms** — 7
   Leave the product name as it is. Leave **Additional licence terms**, **Privacy policy** and
   every other field untouched.

7. **Store listings → English → Screenshots.** Remove the old ones and upload the five
   `*-en.png` files from `03-screenshots/`, in number order. The first one is what people see
   first, so keep `01-home-en.png` first.

8. **Store listings → 中文(繁體).** The same four fields and the five `*-zh-Hant.png`
   screenshots. If that listing does not exist yet, **Add a Store listing → 中文(繁體)**.

9. **The other six languages.** Add a Store listing for each of 中文(简体), Español, Français,
   Deutsch, Italiano and Português and paste their four fields. Screenshots are optional for
   these — a listing with no screenshots of its own falls back to the English ones, which is
   better than nothing and is what 0.3.16 does today.

10. **What's new in this version.** In each language's listing, paste that language's text from
    `05-whats-new-0.3.17.md`.

11. **Submission options → Notes for certification.** Paste the whole block from
    `04-notes-for-certification.md`. This is the one that most affects whether the review passes
    first time: the reviewer will not have a pen.

12. **Review and submit.** Read the summary page, then press **Submit to the Store**.

13. Tell me it is submitted, and I will record the date and the package hash in
    `tasks/PM-STATUS.md`.

### What Partner Center may object to, and what to do

| If it says | What it means | What to do |
|---|---|---|
| "Package is not signed" or a certificate error | It expected a signature | It should not — Microsoft signs on ingestion, and electron-builder leaves a Store package unsigned on purpose. If it genuinely refuses, stop and tell me rather than signing it by hand: a self-signed package will be rejected later for a publisher mismatch. |
| "Package with the same version already exists" | 0.3.17.0 has been uploaded before | Do not bump the version to get past it. Tell me — the package in the folder is the one that was tested, and a new version number means a new build. |
| An identity or publisher mismatch | The manifest does not match the account | Should not happen; it is checked against the built package by CI. Stop and tell me. |
| A screenshot is refused for its size | Outside 1366x768 – 3840x2160 | Should not happen; every file is checked. Tell me which one. |
| A field is too long to save | A limit changed | The character counts are in `02-store-listing-0.3.17.md`. Tell me which field and I will shorten it. |
| Age rating questionnaire reappears | Microsoft has changed it | Answer it honestly: no user-to-user communication, no user-generated content shared with others, no advertising, no purchases in the app. |
| Certification fails on 10.1.1.11 (tiles) | Default placeholder art | It was this in 0.3.15. The art is checked against the built package now; if it recurs, send me the failure text. |

### After it is approved

Only once Partner Center reports the submission as **published**, follow the section below to
create the final `v0.3.17` Release.

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
| `v0.3.17-rc2` | From `2ad7a0b`. Pre-release. The first build that names itself: Settings shows `0.3.17 (rc2, 2ad7a0b)`. |
| `v0.3.17-rc3` | From `9e02f4e`. Pre-release. |
| `v0.3.17-rc4` | From `ae94b07`. Pre-release, **Superseded** — its Store installer lost its stamp before publishing and shows a plain `0.3.17`, so a tester cannot tell it from the Store version. Left in place as the record; do not hand it to anyone. |
| `v0.3.17-rc5` | From `dbfb545`. Pre-release. **The build to test.** Two installers: the Store build and the Internal build, both stamped `0.3.17 (rc5, dbfb545)`. |

`v0.3.17` itself does not exist yet, and must not until the Store has approved 0.3.17.
