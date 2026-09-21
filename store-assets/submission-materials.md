# PonyABC Desktop — Microsoft Store Submission Draft

Mirrors the Claude Docs artifact at https://claude.ai/artifact/6xaNsApBvVSTLXBJwqnMQX, saved here
so the work survives a lost terminal/conversation. See `tasks/todo.md`'s "Microsoft Store (MSIX)
packaging" section for the full technical build/verification log this draft is grounded in.

Package identity: `PonyABC.PonyABCDesktop` · Publisher `CN=E476FCF5-1C63-4A56-85B1-DA5D642911B5` ·
Store listing: [9P544XC6B609](https://apps.microsoft.com/detail/9P544XC6B609)

## Intended audience (governs the wording below throughout)

PonyABC Desktop is a **device and educational-content management utility**, not a game and not
an app aimed at children to operate independently. Its users are **parents, teachers, school
staff, and business users** who manage PonyABC talking pens and their content. The learning
material used *on the pens* may be suitable for children, but that doesn't make the management
app itself child-directed — every description below reflects that distinction deliberately.

## Store description (long)

PonyABC Desktop helps parents, teachers, and organisations manage audio recordings, educational
BOOK content, and firmware for PonyABC talking pens. Register a pen, manage the recordings on its
SD card, browse and install PonyABC's official BOOK library, and (on Windows) keep firmware up to
date — all from one app.

**What you can do:**

- **Register a pen** — opens PonyABC's warranty registration page in your browser.
- **Manage DIY recordings** — a two-pane view of a pen's SD card and your computer, with safe
  copy and replace operations: nothing on the pen is overwritten without confirmation, and
  existing content is backed up before any replacement.
- **Browse and install the BOOK library** — PonyABC's official educational audio content,
  downloaded once and cached locally so repeat installs don't re-download.
- **Update firmware (Windows)** — a guided wizard for official PonyABC pen firmware updates, with
  session logs you can export for support.
- **Use it in your language** — English, Traditional Chinese, Simplified Chinese, Spanish,
  French, German, Italian, and Portuguese.

A PonyABC P5 pen is required for full functionality (recording transfer, installing BOOK content
onto the pen, and firmware updates). The app and the BOOK library can be browsed without a pen
connected.

## Short description / tagline

Manage recordings, BOOK content, and firmware for PonyABC pens — for parents, teachers, and
schools. *(100 characters, fits a typical Store short-description limit.)*

## Feature list

| Feature | What it does |
| --- | --- |
| Pen registration | Opens PonyABC's warranty registration page in your browser |
| DIY recordings manager | Two-pane pen SD card ⇄ computer view; safe copy/replace, backs up before any replacement, never silently overwrites the pen |
| BOOK library | Browse, download, and install PonyABC's official educational audio content; downloads are cached locally |
| Firmware wizard (Windows only) | Guided official PonyABC pen firmware update, with an exportable diagnostic session log |
| 8 interface languages | English, Traditional Chinese, Simplified Chinese, Spanish, French, German, Italian, Portuguese |
| Diagnostics export | One-click export of app/version and (Windows) firmware session logs for support |

## Release notes (current version, v0.3.15)

Firmware wizard improvements: a clearer result screen, one-click return to Home after finishing a
firmware session (it no longer quits the app), and structured diagnostic session logs you can
export for support.

Note: the Store packaging work itself (this submission) is not yet a released version — it will
ship as the next version once this draft is approved and remaining verification (see `tasks/
todo.md`) is complete.

## Category

**Recommended: Utilities & tools.** The app's core function is device management and content
synchronization (firmware updates, SD-card file transfer, downloading/caching official content) —
the same category of function as other hardware-companion and sync utilities, regardless of who
uses it or what the content is about. **Education is not recommended as primary**: that category
is for apps that themselves deliver a learning experience directly to a learner, which this app
does not — it manages a device and its content on the user's behalf. (If Partner Center allows a
secondary/alternate category tag, Education could reasonably apply given the audience and content
domain, but the primary classification should reflect what the app *does*, not who ultimately
benefits from the pen's content.)

## Support and privacy fields

| Field | Value |
| --- | --- |
| Support contact | marketing@ponyabc.co.uk (already used in-app: Settings → Support) |
| Privacy policy URL | https://register.ponyabc.uk/privacy (already linked in-app: Settings → Privacy & Legal) — see the privacy notice below and Remaining requirements |
| Publisher display name | PonyABC (exact Partner Center value — unchanged, not the registered company name) |
| Legal company name | MACROKINETIC MEDIATECH LIMITED |
| Company number | 16420643 |
| Registered office | 128 City Road, London, United Kingdom, EC1V 2NX |
| Correspondence / public contact address | 34 Redbourne Avenue, London, United Kingdom, N3 2BS — **not** the registered office; use only where a form asks for a public/customer-contact address, not a legal/registered address field |

## Certification notes (paste into Partner Center's "Notes for certification")

This app is a companion for a physical Bluetooth talking pen (the PonyABC P5). Its users are
parents, teachers, school staff, and business users managing pens and their content — it is not
designed for a child to operate independently, and is not a game. Several features require the
physical pen and cannot be exercised by a reviewer without one.

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
core, described functionality of a pen-management app — not unrelated secondary software, and not
a remote script executed outside the described purpose. The elevation prompt applies only to that
one vendor tool, only when the user explicitly starts a firmware update, never at app launch or in
the background. **Real evidence, not just a design claim**: a real Windows machine confirmed this
mechanism completes successfully and produces a real UAC consent prompt from a genuine
non-administrator session (see `tasks/todo.md`).

**Note on admin elevation:** this app does not request the `allowElevation` restricted capability
and is not elevated itself. The UAC prompt targets only the downloaded vendor firmware tool,
launched as a separate, unpackaged process — the packaged app itself always runs at normal
(non-elevated) integrity.

## Screenshots and image assets

**Status: all 5 done, captured from the actual Microsoft Store package running on a real
Windows CI machine** (not a macOS dev build) — Home, My Recordings, BOOK Library, Firmware
wizard (genuine "Prepare your pen" step), and Settings/About (correctly reading "Windows · x64
(Microsoft Store)"). Saved in this repo under `store-assets/screenshots/` (see that folder's own
README for exact filenames and the CI run they came from).

- **Logo/icon**: `build/icon.png` (1024×1024) is already large enough for every required Store
  tile size.
- To recapture after a future UI change: same script, run against any installed build's .exe —
  see `store-assets/README.md`.

## Privacy notice — complete text is a separate file, not summarized here

**The full, complete, untruncated privacy notice is saved at
[`store-assets/privacy-notice-desktop.md`](./privacy-notice-desktop.md) in this repo.** It is
grounded in an actual investigation of what the app's own code sends, and separately what
Cloudflare/GitHub infrastructure may retain as ordinary connection metadata — not assumed, and
not summarized as "no personal information is collected" (that file explains exactly why not).
Intended public URL: `https://register.ponyabc.uk/privacy/desktop` (does not replace or modify
the existing `https://register.ponyabc.uk/privacy` page). That file's own "Open items" section
lists what's still needed before publishing (Cloudflare plan/retention confirmation, legal
wording review, and the actual page implementation in `ponyabc-web` — not done yet, pending your
review of the text).

## Age rating (IARC) — mapped to real IARC categories, not a blanket "None"

**"Suitable for all ages" expresses our own intended suitability for the app's content and
functionality — it is not a preassigned or official age rating.** The real rating is computed by
Microsoft/IARC from the actual questionnaire answered in Partner Center, which is interactive and
adapts to the app category selected — I do not have Partner Center access to quote its exact
live on-screen wording. The categories and reasoning below are mapped to IARC's own
publicly-documented content-descriptor and "Interactive Elements" categories (the same categories
that appear on the resulting rating certificate), so the real, final answers can be entered
accurately. Being a management/utility tool for adults does not remove privacy or
content-disclosure obligations — every answer below is given on its own merits, not defaulted.

| IARC category | What it actually asks about | Proposed answer | Reasoning |
| --- | --- | --- | --- |
| Violence | Depictions of harm to characters/people/animals | None | No such content anywhere in the app or its own UI. |
| Fear / horror themes | Scary or horror content | None | No such content anywhere in the app's own UI. |
| Sexual content / nudity | Sexual content or nudity | None | No such content anywhere in the app. |
| Language / profanity | Strong language, slurs, crude humor | None | No such content anywhere in the app's own UI. |
| Controlled substances | References to alcohol, tobacco, or drugs | None | No such content anywhere in the app. |
| Gambling | Real-money or simulated gambling | None | No such content anywhere in the app. |
| Users interact | Chat, messaging, multiplayer, or other direct interaction between users | None | No chat, messaging, multiplayer, comments, or any user-to-user interaction feature of any kind. |
| Shares user-generated content with others | Content one user creates being visible/accessible to *other* users or the public | None — **but see the two distinct cases below, don't conflate them** | **DIY recordings**: 100% local — copied only between a user's own pen and their own computer; there is no mechanism for any other user to see, access, or receive them. **BOOK content**: flows the opposite direction (professionally curated content downloaded *from* PonyABC to the user); it is not user-generated at all. Neither matches what this descriptor is actually about (content visible to other users), so the honest answer is "no" for both, for different reasons. |
| Shares personal information | The app sharing a user's personal info with other users or third parties | None | Confirmed by code review — see the privacy notice. No mechanism exists for a user to share personal info with another user or the public through the app. |
| Shares location | The app sharing device/user location | None | The app never reads or transmits location. |
| Unrestricted internet access | An embedded/unfiltered browser or web view inside the app | None | The app has no embedded browser; external links (registration, privacy policy, releases page) open in the operating system's own default browser, never inside the app itself. |
| Digital purchases | Real-money or virtual in-app purchases | None | Confirmed by code review — no purchase, payment, or billing code anywhere in the app. |
| Intended audience / target user (context, not an IARC content category itself) | — | Parents, teachers, school staff, and business users managing PonyABC pens — not designed for a child to operate independently, and not a game. | Per the app's actual functionality (device/content management), not the age of learners who may use the physical pen. |

## Remaining requirements (everything already verified/confirmed is not repeated here)

Packaging, manifest identity, install, launch, the harmless elevation/logging mechanism (approved
once, from a real non-administrator session on Benny's own Windows machine), legal company
details, audience framing, category, and all 5 Store screenshots (genuine Windows captures) are
confirmed/complete with real evidence — see `tasks/todo.md`'s "Microsoft Store (MSIX) packaging"
section. Only these remain before this draft is submission-ready:

1. **Publish the privacy notice** at `https://register.ponyabc.uk/privacy/desktop` (hosting URL
   confirmed). Complete text is in `store-assets/privacy-notice-desktop.md`; that file's own
   "Open items" lists what's left: Cloudflare plan/retention confirmation, your wording review,
   and the actual `ponyabc-web` page implementation (not built yet — pending your review of the
   text first).
2. **Age rating (IARC) answers.** Mapped to real IARC categories above — enter these (or your
   own) directly in Partner Center; the actual rating is computed there, not decided here.
3. **Optional, not blocking**: a UAC-decline run and an interrupted-launch recovery check (steps
   in the test kit's README) — useful additional evidence, not required to finalize this draft.
4. **Your final review and explicit go-ahead** — nothing gets submitted to Partner Center until
   then.
5. **Partner Center itself**: I have no access to Partner Center from this environment (no
   credentials, no browser session, no API tool) — I cannot prepare or update the actual draft
   there. Everything above is ready to paste in when you have a Partner Center session open.

Full technical build/verification/testing log: `tasks/todo.md` in the `ponyabc-desktop` repo
("Microsoft Store (MSIX) packaging" section). The Windows test kit (package, checksum,
certificate, install/probe/cleanup scripts, and full instructions) is at
`store-assets/windows-test-kit/` in that repo.
