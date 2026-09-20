# PonyABC Desktop — Microsoft Store Submission Draft

Mirrors the Claude Docs artifact at https://claude.ai/artifact/6xaNsApBvVSTLXBJwqnMQX, saved here
so the work survives a lost terminal/conversation. See `tasks/todo.md`'s "Microsoft Store (MSIX)
packaging" section for the full technical build/verification log this draft is grounded in.

Package identity: `PonyABC.PonyABCDesktop` · Publisher `CN=E476FCF5-1C63-4A56-85B1-DA5D642911B5` ·
Store listing: [9P544XC6B609](https://apps.microsoft.com/detail/9P544XC6B609)

## Store description (long)

PonyABC Desktop is the official companion app for the PonyABC Bluetooth talking pen. Register
your pen, manage the recordings on its SD card, browse and download PonyABC's official BOOK
library, and (on Windows) keep your pen's firmware up to date — all from one app.

**What you can do:**

- **Register your pen** — opens PonyABC's warranty registration page in your browser.
- **Manage DIY recordings** — a two-pane view of your pen's SD card and your computer, with safe
  copy and replace operations: nothing on the pen is overwritten without your confirmation, and
  existing content is backed up before any replacement.
- **Browse and install the BOOK library** — PonyABC's official audio content, downloaded once and
  cached locally so repeat installs don't re-download.
- **Update firmware (Windows)** — a guided wizard for official PonyABC pen firmware updates, with
  session logs you can export if you need support.
- **Use it in your language** — English, Traditional Chinese, Simplified Chinese, Spanish,
  French, German, Italian, and Portuguese.

A PonyABC P5 pen is required for full functionality (recording transfer, installing BOOK content
onto the pen, and firmware updates). You can explore the app and browse the BOOK library without
a pen connected.

## Short description / tagline

Register, manage recordings, and update firmware for your PonyABC talking pen.

## Feature list

| Feature | What it does |
| --- | --- |
| Pen registration | Opens PonyABC's warranty registration page in your browser |
| DIY recordings manager | Two-pane pen SD card ⇄ computer view; safe copy/replace, backs up before any replacement, never silently overwrites the pen |
| BOOK library | Browse, download, and install PonyABC's official audio content; downloads are cached locally |
| Firmware wizard (Windows only) | Guided official PonyABC pen firmware update, with an exportable diagnostic session log |
| 8 interface languages | English, Traditional Chinese, Simplified Chinese, Spanish, French, German, Italian, Portuguese |
| Diagnostics export | One-click export of app/version and (Windows) firmware session logs for support |

## Release notes (current version, v0.3.15)

Firmware wizard improvements: a clearer result screen, one-click return to Home after finishing a
firmware session (it no longer quits the app), and structured diagnostic session logs you can
export for support.

Note: the Store packaging work itself (this submission) is not yet a released version — it will
ship as the next version once this draft is approved and a real Windows-machine verification pass
(see `tasks/todo.md`) is complete.

## Category, support, and privacy fields

| Field | Value |
| --- | --- |
| Category (proposed) | Education — the app's target use case is a children's talking-pen companion; Utilities & tools is a reasonable alternate. Final call is Benny's. |
| Support contact | marketing@ponyabc.co.uk (already used in-app: Settings → Support) |
| Privacy policy URL | https://register.ponyabc.uk/privacy (already linked in-app: Settings → Privacy & Legal) — see the privacy notice draft and Open items below |
| Publisher display name | PonyABC (exact Partner Center value — do not substitute the registered company name) |

Registered legal entity: **MACROKINETIC MEDIATECH LIMITED** (confirmed). Only genuinely missing
for any Partner Center business-declaration field: the company registration number and registered
address (also needed for the in-app Settings → Privacy & Legal panel, which currently says these
are "to be confirmed").

## Certification notes (paste into Partner Center's "Notes for certification")

This app is a companion for a physical Bluetooth talking pen (the PonyABC P5). Several features
require that hardware and cannot be exercised by a reviewer without one.

**Fully testable without a P5 pen:**
- App launch, navigation, Settings, and all 8 interface languages
- "Register your pen" (opens an external browser page — does not require a pen)
- BOOK library browsing and catalog metadata (network-based; downloading BOOK files to the
  computer works without a pen — only the final install-onto-pen step needs one)
- Diagnostics export (About panel and general app diagnostics)
- Update-check behavior (Store builds show "handled automatically"; this is intentional — see
  the app's Settings → About)

**Requires a real P5 pen and cannot be tested by a reviewer:**
- The DIY recordings manager's actual pen ⇄ computer file transfer (the pen's SD card must be
  mounted)
- Installing BOOK content onto the pen itself
- The Windows firmware wizard's actual flash step

**Why this app downloads and runs an external firmware tool (Windows firmware wizard):** The
firmware wizard downloads the pen vendor's own official firmware-flashing utility (a small set of
vendor-signed Windows executables and batch scripts) and runs it, with the user's explicit action
and a standard Windows UAC elevation prompt, to write new firmware to the connected pen. This is
core, described functionality of a pen-companion app (updating the pen's own firmware) — not
unrelated secondary software, and not a remote script executed outside the described purpose. The
elevation prompt applies only to that one vendor tool, only when the user explicitly starts a
firmware update, never at app launch or in the background.

**Note on admin elevation:** this app does not request the `allowElevation` restricted capability
and is not elevated itself. The UAC prompt targets only the downloaded vendor firmware tool,
launched as a separate, unpackaged process — the packaged app itself always runs at normal
(non-elevated) integrity.

## Screenshots and image assets

**Status: 3 of 5 captured for real, 2 still need a genuine Windows-build recapture.** All were
taken with a new CDP-driven tool (`scripts/capture-screenshots.mjs`, click-through automation —
never hand-drawn) against a real running build, saved in this repo under `store-assets/
screenshots/` (see that folder's own README for exact usability notes).

- **Ready to use**: Home, BOOK Library, My Recordings — generic content, no platform-specific
  text visible.
- **Needs a Windows recapture**: Firmware (the Mac capture just shows "not available on Mac" —
  correct behavior, but would read as broken on a Windows listing) and Settings/About (visibly
  shows "Mac · Apple Silicon"; needs to show "Windows · x64 (Microsoft Store)" instead).
- **Logo/icon**: `build/icon.png` (1024×1024) is already large enough for every required Store
  tile size.
- Once the Windows CI build/install verification (see `tasks/todo.md`) is available, the same
  script runs identically against the installed package's .exe to fill the 2 remaining shots.

## Privacy notice (draft — not yet submission-ready, see caveat below)

Grounded in the actual code (verified this session: no analytics/telemetry/tracking/purchase code
anywhere in the app; the only network calls are to public, unauthenticated endpoints). This is a
DRAFT for Benny's review, not a claim that it's ready to publish as-is — it still needs a hosting
decision and a legal/business-info fill-in (see the marked gaps and Open items below).

**Supplements, does not replace,** the general policy at `https://register.ponyabc.uk/privacy`
(which covers pen warranty registration and the PonyABC website — that page's own text is still
marked "placeholder pending legal review", a separate, real gap tracked in Open items).

> **What PonyABC Desktop stores on your computer**
> Your selected interface language, and the most recently used pen/computer folder paths —
> stored locally in a settings file, never transmitted anywhere. Diagnostic and firmware session
> logs (app version, platform, and event timestamps) — stored locally, and only leave your
> computer if you choose to export them and attach them to a support email yourself.
>
> **What PonyABC Desktop sends over the network, and why**
> - *BOOK library*: the app fetches the public list of available BOOK content and downloads
>   files you choose to install, from PonyABC's servers. These requests carry no name, email, or
>   other personal identifier — they're the same for every user.
> - *Firmware updates (Windows only)*: the app checks for and downloads pen firmware files,
>   identified only by a hardware revision constant — not by any personal identifier.
> - *Update checks*: the GitHub-distributed build checks GitHub's public release list for a newer
>   version; the Microsoft Store build skips this entirely (the Store manages its own updates).
> - *Registration*: the "Register your pen" button opens PonyABC's warranty registration page in
>   your own web browser. Anything you enter there is submitted directly to that website, not
>   through this app — see the general privacy policy above for how that page itself handles it.
>
> **What PonyABC Desktop does not do**
> No analytics, tracking, or advertising of any kind. Does not transmit your files, recordings,
> or local settings to PonyABC or anyone else. Does not collect or transmit personal information
> on its own initiative.
>
> **Contact**
> Support: marketing@ponyabc.co.uk. Registered company: MACROKINETIC MEDIATECH LIMITED
> (registration number and registered address: *needed from Benny*).

## Age rating (IARC) — proposed answers for review, not submitted

Proposed based on an actual review of the app's real functionality (no code for any of the
flagged categories exists) — Benny gives the real, final answers in Partner Center; nothing here
is submitted on anyone's behalf.

| Category | Proposed answer | Basis |
| --- | --- | --- |
| Violence | None | No such content anywhere in the app. |
| Sexual content / nudity | None | No such content anywhere in the app. |
| Profanity / crude humor | None | No such content anywhere in the app. |
| Controlled substances (alcohol/tobacco/drugs) | None | No such content anywhere in the app. |
| Gambling | None | No such content anywhere in the app. |
| User-generated content shared with others | None | DIY recordings are local pen⇄computer only, never uploaded or shared with other users; BOOK content is curated by PonyABC, not user-generated. |
| Interaction with other users / social features | None | No chat, multiplayer, or social features of any kind. |
| Location sharing | None | The app never reads or transmits location. |
| Shares personal info with third parties | None | Confirmed by code review this session — see the privacy notice draft above. |
| Digital purchases / in-app purchases | None | Confirmed by code review this session — no purchase, payment, or billing code anywhere in the app. |

## Open items requiring Benny's factual input (not invented or guessed)

1. **Privacy policy scope.** `https://register.ponyabc.uk/privacy` is live and public, but its
   own text is marked "placeholder text pending legal review" and only describes the
   pen-registration website's data collection — it never mentions the desktop app. Store Policy
   requires the linked policy to describe what the *submitted product* actually does with
   personal data. A full draft is above — decide: publish that (or similar) as a new section/page,
   and where it should live (extend the existing page, or host separately)?
2. **Age rating (IARC) questionnaire.** Proposed answers are above for review — Benny gives the
   real, final answers in Partner Center.
3. **Business info.** Only the company registration number and registered address are genuinely
   missing (see the Category/support/privacy section above) — the legal entity name
   (MACROKINETIC MEDIATECH LIMITED) and Store identity (PonyABC) are already confirmed.
4. **Real screenshots.** 3 of 5 captured for real (see Screenshots section above); Firmware and
   Settings/About still need a genuine Windows-build recapture.

See `tasks/todo.md` in the `ponyabc-desktop` repo ("Microsoft Store (MSIX) packaging" section)
for the full technical build/verification log, including the open risks around the firmware
wizard's elevation flow under MSIX packaging.
