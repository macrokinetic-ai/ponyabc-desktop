# Microsoft Store release checklist — PonyABC Desktop

Store ID **9P544XC6B609** · `https://apps.microsoft.com/detail/9P544XC6B609`
Currently live: **APPX 0.3.16.0** (source commit `f39df08`, tagged `v0.3.16`).

Derived from §13 of `docs/store/PonyABC-Microsoft-Store-AI-Handover.md`, corrected
against the repo on 2026-09-29.

**Division of labour, and it is absolute:**

|                      |                                                                                                               |
| -------------------- | ------------------------------------------------------------------------------------------------------------- |
| **Claude / AI does** | repo, version bumps, build config, CI, package verification, checksums, release notes drafts, this checklist  |
| **You do**           | every Partner Center action — logging in, uploading, filling fields, submitting, and pressing **Publish now** |

An AI must never log in to Partner Center, upload a package, submit for certification, or
publish. Nothing in this file authorises it.

---

## Phase 1 — before any code changes (AI)

- [ ] `git status`; confirm nothing uncommitted is about to be lost. **Never discard the
      user's work.**
- [ ] Confirm `main` contains everything that shipped last time:
      `git merge-base --is-ancestor v0.3.16 main` must succeed.
- [ ] Note the currently published version from `store-assets/PUBLISHED-STORE-VERSION`.
- [ ] Create `release/<next-version>` from `main`.

## Phase 2 — version (AI)

- [ ] Bump `package.json` to the new version; regenerate `package-lock.json`.
- [ ] The APPX manifest version is **derived** — electron-builder appends `.0`, so
      `0.3.17` → `0.3.17.0`. Do not hand-edit a manifest.
- [ ] The new version **must be strictly higher** than `PUBLISHED-STORE-VERSION`.
      Partner Center rejects anything equal or lower. CI now enforces this.
- [ ] **Never change** these four. They are the product's identity in the Store:

      | Field | Value |
      | --- | --- |
      | Identity/Name | `PonyABC.PonyABCDesktop` |
      | Identity/Publisher | `CN=E476FCF5-1C63-4A56-85B1-DA5D642911B5` |
      | PublisherDisplayName | `PonyABC` |
      | Store ID | `9P544XC6B609` |

      CI asserts all three manifest values and fails the build on any mismatch.

## Phase 3 — build and verify the PACKAGE, not the sources (AI)

Run the Windows CI build (`build-windows.yml`, `workflow_dispatch` or a push to `main`).
It extracts the final `.appx` and fails the build on any of:

- [ ] manifest identity ≠ the four values above
- [ ] manifest `Identity/Version` ≠ `package.json` version + `.0`
- [ ] version not higher than `PUBLISHED-STORE-VERSION`
- [ ] any manifest-referenced tile/logo/scale asset missing from the package
- [ ] any packaged asset matching a known electron-builder default (by SHA-256)
- [ ] `resources.pri` missing (scaled assets not indexed)
- [ ] `.sha256` sidecar missing or not matching the `.appx`
- [ ] `build/icon.ico` missing, too small, or ≠ `build/icon.ico.sha256.expected`

Then, still AI:

- [ ] Record the APPX SHA-256 and the CI run URL in the release notes.
- [ ] Download the CI artifact and confirm it is byte-identical to whatever you hand over
      — this is how `v0.3.16`'s provenance was proven, and it takes one command.
- [ ] Run the test suite and the Mac build if the change touches shared code.
- [ ] **Icons changed?** Also eyeball the rendered tiles. CI proves assets exist and are
      not defaults; it cannot tell you they look right.

## Phase 4 — merge and tag (AI)

- [ ] Merge `release/<version>` into `main` (show conflicts before resolving anything
      non-trivial).
- [ ] Tag the **exact commit CI built from**, annotated with: CI run id, artifact name,
      APPX SHA-256. Push the tag.
- [ ] ⚠️ Pushing a `v*` tag triggers `build-windows.yml` and it can attach artefacts to a
      **GitHub Release**. That is GitHub only — it cannot reach the Microsoft Store — but
      expect the run and tell the user.

## Phase 5 — Partner Center (YOU — the user, alone)

The AI's part is finished. It can read you these steps; it must not perform them.

- [ ] Partner Center → the product → **Start update** (do not create a new product).
- [ ] **Packages** → upload the new `.appx` → wait for validation.
- [ ] The previous package appears struck through with a "Save to remove" prompt. That is
      expected when the new package serves the same customers.
- [ ] Device families: **Windows 10/11 Desktop only**. Leave Mobile / Xbox / Team / Mixed
      Reality unchecked, and leave the "automatically extend to future device families"
      box unchecked.
- [ ] `runFullTrust` may raise an approval warning — the justification is in handover §8.
- [ ] **Save.**
- [ ] Update **What's new** for this version. (It may be blank only on a first submission.)
- [ ] **Additional Testing Information**: keep the existing hardware/UAC testing notes and
      append anything specific to this release. Reviewers rely on this.
- [ ] Re-check anything the change touched: Store listing, screenshots, age rating,
      Properties. Leave the rest alone.
- [ ] **Submit for certification.**
- [ ] Wait for certification. "Packages Validated" is **not** certification, and
      "Complete" only means the form is filled in.
- [ ] Once certified, if the release is on manual hold, press **Publish now**. Certified ≠
      published.
- [ ] Confirm **In Microsoft Store**, then open
      `https://apps.microsoft.com/detail/9P544XC6B609` and check it returns 200.
- [ ] **Install from the real Store on a real machine and run it.** Still never done for
      any release. Publishing is not proof the product works.

## Phase 6 — after publishing (AI, once you confirm)

- [ ] Update `store-assets/PUBLISHED-STORE-VERSION` to the newly published version, so the
      next build's "must increase" check has the right baseline.
- [ ] Record in `tasks/todo.md`: version, source commit, CI run, APPX SHA-256, publish
      date.
- [ ] Confirm the release tag is pushed and reachable.

## The four ways a release has gone wrong here

Every one of these actually happened, or came one step from happening:

1. **Default Electron tile art shipped** → certification failure 10.1.1.11 (v0.3.15). The
   EXE icon was already correct; the APPX tiles were not. They are separate assets, and a
   Store-listing logo upload fixes neither.
2. **The fix was never merged to `main`.** For six days after publishing, `main` had no
   `build/appx`, no `electron-builder.win-appx.yml`, no asset generator, and version
   `0.3.15`. A release cut from `main` would have reproduced the rejection exactly.
3. **Version lower than published.** `main` read `0.3.15` while `0.3.16.0` was live.
   Partner Center refuses it. Now blocked by CI.
4. **Source assets verified instead of the package.** `build/appx/` being correct says
   nothing about what ended up inside the `.appx`. Always extract and check the real
   container.
