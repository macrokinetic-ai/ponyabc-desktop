# Two builds, and the web contract — 0.3.17 rc4

Owner decisions, 2026-09-30. 0.3.17 is not yet submitted, so all of this is allowed.
Never log in to Partner Center, submit, or publish.

## 0. Match the web contract first
- [ ] `state` (active/retired/remove_from_pens/hidden) replaces `lifecycleState` everywhere
- [ ] `X-PonyABC-App-Version` on every catalogue and firmware request
- [ ] `min_app_version` honoured as a second guard, client-side
- [ ] a contract test built from the web branch's own response examples

## A. Two builds from every commit
- [ ] audit and list every developer/support path in the app
- [ ] STORE build: none of them, excluded at compile time
- [ ] INTERNAL build: own name, AppId and badged icon; permanent banner; version reads
      "0.3.17 (rc4, <commit>) · Internal"
- [ ] CI fails if an internal package carries the Store identity
- [ ] tests proving the Store build contains no developer path

## B. Book and firmware rules, both builds
- [ ] confirm the BIN preflight is per-upgrade, not per-version
- [ ] remove_from_pens: remove matching books first, then add/update, one index reset at the
      end, peak space includes the removals, and the parent is told in plain words first
- [ ] retired never added but still updated; hidden never shown in the Store build
- [ ] 8 locales, UK English

## C. Testing mode, Internal build only
- [ ] Settings → Testing mode: a local test-catalogue folder, and the server tester channel
- [ ] test items go through exactly the same sync code as real ones
- [ ] firmware: choose V1.18 or V1.26 and run the normal wizard with the preflight
- [ ] docs/test-plans/internal-testing.md with a ready manifest.json

## D. Gates
- [ ] typecheck, vitest, build, Windows CI for both builds
- [ ] Release v0.3.17-rc4 with both builds
- [ ] PM-STATUS and store-release-checklist: only the Store build is ever submitted
- [ ] report, INDEX, push to ponyabc-reports
