# PonyABC Desktop — Privacy Notice (complete draft, for review before publishing)

**Intended public URL:** `https://register.ponyabc.uk/privacy/desktop`
**Status:** Draft for Benny's review — not yet published. Deploying this does not change or
remove the existing registration-site privacy policy at `https://register.ponyabc.uk/privacy`,
which stays exactly as it is.

This notice covers the **PonyABC Desktop application** specifically — a separate document from
the general PonyABC / pen-registration website privacy policy linked above, which continues to
cover the website and the physical warranty registration process.

---

## 1. Who is responsible for this app

PonyABC Desktop is provided by PonyABC (trading name of **MACROKINETIC MEDIATECH LIMITED**,
company number **16420643**).

- **Registered office:** 128 City Road, London, United Kingdom, EC1V 2NX
- **Correspondence / public contact address** (for customer enquiries — this is **not** our
  registered office): 34 Redbourne Avenue, London, United Kingdom, N3 2BS
- **Support and privacy contact:** marketing@ponyabc.co.uk

## 2. What this notice covers

PonyABC Desktop is a Windows/macOS application for managing a PonyABC talking pen: registering
it, transferring recordings, browsing and installing educational BOOK content, and (Windows only)
updating firmware. This notice explains what the **application itself** does with data — not the
separate warranty-registration website, which the app only ever opens in your own browser.

## 3. What stays only on your computer

- **Your settings**: interface language, and the most recently used pen and computer folder
  paths. Stored in a local settings file on your device. Never transmitted anywhere by the app.
- **Your recordings and BOOK files**: DIY audio recordings and any BOOK content you install are
  copied directly between your pen and your computer by the app. The app never uploads either to
  us or to anyone else.
- **Diagnostic logs**: the app keeps a small local technical log (connection attempts, download
  outcomes, matching results, and — on Windows — firmware session details) to help troubleshoot
  problems if you contact support. This log is capped (the most recent 500 general entries, or
  the most recent 20 firmware sessions), and file paths, personal data, and authentication
  details are automatically redacted before anything is shown or saved. **This log is never sent
  anywhere automatically.** It only leaves your computer if you deliberately choose to export it
  to a file (Settings → Diagnostics) and then choose to attach that file to a support email
  yourself.

## 4. What the app sends over the network, and to whom

The app contacts exactly three external hosts. We list what each one can see, distinguishing
**what our own application code sends** from **what the underlying hosting/network
infrastructure may separately retain as a normal, standard part of serving any web request** —
these are different things, and we don't want to blur them together.

### 4.1 `register.ponyabc.uk` (our own backend, hosted on Cloudflare)

Used for: browsing/downloading the BOOK library, checking for and downloading firmware, and (via
your browser, not the app directly) pen registration and this privacy policy itself.

- **What our application code does**: our BOOK-catalog, firmware-catalog, and download API
  routes (`/api/public/books`, `/api/public/firmware`, and their `/download` endpoints) do not
  require any login or device identifier, and our route code does not read, log, or store your IP
  address, a device ID, or any other personal identifier for these specific requests — they are
  answered identically for every caller. (This is different from our website's own pen-warranty
  *registration* form, which is a separate flow: it does store a **salted, one-way cryptographic
  hash** of the submitter's IP address — never the raw IP — strictly for abuse-prevention
  forensics on registration submissions. The desktop app's BOOK/firmware/download requests never
  go through that code path at all.)
- **What our hosting infrastructure (Cloudflare) may separately retain**: like essentially any
  web service, our backend runs on Cloudflare, which provides platform-level request
  observability/logging (IP address, timestamp, requested path, response status) as part of its
  standard operation, security, and abuse-prevention systems — this is Cloudflare's
  infrastructure-level logging, not something our application code specifically requests or can
  fully disable, and it is standard for practically any internet-connected service, not unique to
  this app. **What we have confirmed, and what remains open:** Cloudflare Workers' own
  observability/logging feature is enabled for this backend. Cloudflare's own documented default
  retention for this feature is 3 days (Free plan) or 7 days (Paid plan) — **which plan tier
  applies to this specific deployment has not been independently confirmed for this notice**, and
  we are not stating a specific number of days here until it is. We will update this section once
  confirmed, rather than guess.
- Firmware and BOOK content files themselves are stored in Cloudflare R2 object storage and served
  through the same Worker; no separate third party is involved in serving them.

### 4.2 `api.github.com` (GitHub, a separate third party)

Used for: the GitHub-distributed build's optional update check (Settings → About → Check for
updates). **The Microsoft Store build does not make this request at all** — the Store manages its
own updates, and our code explicitly skips this check when running as a Store package.

- Our code sends a plain request identifying only the software (`User-Agent:
  PonyABC-Desktop-UpdateCheck`) — never a personal identifier, account, or device ID.
- GitHub, as an independent third-party service we rely on to host our public release
  information, will see your IP address and this request the same way it would for any visitor
  to a public GitHub page, governed by **GitHub's own privacy statement**
  (https://docs.github.com/site-policy/privacy-policies/github-general-privacy-statement), which
  is outside our control.

### 4.3 `github.com` (opened in your own browser, not requested by the app itself)

The "Check for updates" button, when a GitHub-distributed update is available, opens GitHub's
release page in your default web browser. From that point on, you are interacting with GitHub's
website directly and are covered by GitHub's own privacy statement, not this notice or any
request our app code makes.

## 5. What this app does not do

- No analytics, telemetry, tracking, or advertising code of any kind — confirmed by reviewing the
  application's source code, not assumed.
- No purchase, payment, or billing functionality anywhere in the app.
- Does not read or transmit your location.
- Does not share personal information with third parties for their own purposes.
- Being a device- and content-management tool does not exempt it from data protection
  obligations — this notice applies in full regardless of who is using the app or in what
  context (parent, teacher, school, or business).

We deliberately avoid saying "we collect no personal information at all," because that would be
an overstatement: the app's *network requests* carry no personal identifier by design, but the
*infrastructure* those requests travel over (Cloudflare, GitHub) retains ordinary connection
metadata as described in Section 4, and the separate registration website does collect
warranty-registration details under its own policy. We would rather describe this precisely than
make a blanket claim we can't fully stand behind.

## 6. How long things are kept

- Recordings, downloaded BOOK content, and local settings: stay on your computer until you remove
  them yourself or uninstall the app. We have no access to them and cannot delete them remotely.
- The local diagnostics log: automatically discards its oldest entries once it passes its cap (500
  general entries; 20 firmware sessions) — this happens on your device, automatically.
- Cloudflare's platform-level request logs (Section 4.1): retained per Cloudflare's own default
  logging retention — **exact plan/duration not yet independently confirmed for this notice; see
  Section 4.1.**
- GitHub's own logs for update-check/release-page requests (Section 4.2–4.3): governed by
  GitHub's own retention policy, outside our control.

## 7. Your rights

If you are in the UK or EEA, you have rights under UK/EU data protection law, including the right
to access, correct, or request deletion of personal data we hold about you, and the right to
complain to your local data protection authority (in the UK, the Information Commissioner's
Office, ico.org.uk). Because this application itself is designed not to collect personal
identifiers through its own requests (Section 4), in most cases we will have no personal data
about you arising from the app's own network activity to act on. If you have registered a pen's
warranty through our website (a separate flow from this app), requests about that data should be
directed to marketing@ponyabc.co.uk and are covered by the registration website's own privacy
policy at `https://register.ponyabc.uk/privacy`.

## 8. Contact

Questions about this notice, or about the app's data practices: **marketing@ponyabc.co.uk**, or
by post to our correspondence address in Section 1 (not our registered office — see Section 1 for
which address to use for what).

---

## Open items before this can be published (flagged, not resolved here)

1. **Cloudflare plan/retention confirmation** (Section 4.1, 6) — needs an actual check of the
   Cloudflare account's plan tier and log-retention configuration for `ponyabc-pen-registration`,
   which I cannot see from the codebase alone.
2. **Legal review of the wording itself** — Benny's own stated precondition before publishing.
3. **Implementation of the live page** — not yet built. Once this text is approved, the smallest
   correct change is a new page in the `ponyabc-web` repo at the `/privacy/desktop` route, styled
   consistently with the existing `/privacy` page, without modifying that existing page's content
   or route. Not implemented yet — `ponyabc-web` currently has substantial unrelated in-progress
   changes on disk (see that repo's own `git status`), so I have not touched it without your
   go-ahead specifically for this addition.
4. Once published, the **in-app "Open full website privacy policy" button** (Settings → Privacy &
   Legal, currently pointing at `/privacy`) should be reviewed — should it link to `/privacy`,
   `/privacy/desktop`, or both? Not changed yet, pending that decision.
