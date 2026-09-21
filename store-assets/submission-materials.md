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
- Straightforward to capture now that a working Windows test environment exists (see the test
  kit at `store-assets/windows-test-kit/`) — the same script runs identically against the
  installed package's .exe.

## Privacy notice (draft, ready for review — publication location still Benny's call)

Grounded in the actual code (verified this session: no analytics/telemetry/tracking/purchase code
anywhere in the app; the only network calls are to public, unauthenticated endpoints) and the
confirmed company details above.

**Supplements, does not replace,** the general policy at `https://register.ponyabc.uk/privacy`
(which covers pen warranty registration and the PonyABC website — that page's own text is still
marked "placeholder pending legal review", a separate, real gap — see Remaining requirements).

> **PonyABC Desktop — Privacy Notice**
>
> **Who is responsible for this app**
> PonyABC Desktop is provided by PonyABC (trading name of **MACROKINETIC MEDIATECH LIMITED**,
> company number **16420643**). Registered office: **128 City Road, London, United Kingdom, EC1V
> 2NX**. For customer contact and correspondence, please use **34 Redbourne Avenue, London,
> United Kingdom, N3 2BS** or marketing@ponyabc.co.uk — this correspondence address is separate
> from, and should not be treated as, our registered office.
>
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
>   your own web browser. Anything entered there is submitted directly to that website, not
>   through this app — see the general privacy policy above for how that page itself handles it.
>
> **What PonyABC Desktop does not do**
> No analytics, tracking, or advertising of any kind. Does not transmit files, recordings, or
> local settings to PonyABC or anyone else. Does not collect or transmit personal information on
> its own initiative. Being a device/content-management tool does not exempt it from these
> obligations — this notice applies regardless of who is using the app or why.
>
> **Contact**
> Support and privacy queries: marketing@ponyabc.co.uk.

## Age rating (IARC) — proposed answers for review, not submitted

**"Suitable for all ages" below expresses our own intended suitability for the app's content and
functionality — it is not a preassigned or official age rating.** The real rating is computed by
Microsoft/IARC from the actual questionnaire answers entered in Partner Center; nothing here is
submitted on anyone's behalf. Being a management/utility tool for adults does not remove privacy
or content-disclosure obligations — the answers below are given honestly regardless.

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
| Shares personal info with third parties | None | Confirmed by code review — see the privacy notice above. |
| Digital purchases / in-app purchases | None | Confirmed by code review — no purchase, payment, or billing code anywhere in the app. |
| Intended audience / target user | Parents, teachers, school staff, and business users managing PonyABC pens — not designed for a child to operate independently, and not a game. | Per the app's actual functionality (device/content management), not the age of learners who may use the physical pen. |

## Remaining requirements (everything already verified/confirmed is not repeated here)

Packaging, manifest identity, install, launch, and the harmless elevation/logging mechanism
(approved once, from a real non-administrator session on Benny's own Windows machine) are
confirmed working with real evidence — see `tasks/todo.md`'s "Microsoft Store (MSIX) packaging"
section. Legal company details, audience framing, and category are now resolved (this document).
Only these remain before this draft is submission-ready:

1. **Privacy policy hosting decision.** The text above is ready to use. Decide: publish it (or
   similar) as a new section on `register.ponyabc.uk/privacy` (or host it separately), and when —
   the existing page is currently a placeholder marked "pending legal review."
2. **Age rating (IARC) answers.** Proposed above — enter these (or your own) directly in Partner
   Center; the actual rating is computed there, not decided here.
3. **Two remaining screenshots.** Firmware wizard and Settings/About still need a genuine
   Windows-build capture (3 of 5 are already done and usable).
4. **Optional, not blocking**: a UAC-decline run and an interrupted-launch recovery check (steps
   in the test kit's README) — useful additional evidence, not required to finalize this draft.
5. **Your final review and explicit go-ahead** — nothing gets submitted to Partner Center until
   then.

Full technical build/verification/testing log: `tasks/todo.md` in the `ponyabc-desktop` repo
("Microsoft Store (MSIX) packaging" section). The Windows test kit (package, checksum,
certificate, install/probe/cleanup scripts, and full instructions) is at
`store-assets/windows-test-kit/` in that repo.
