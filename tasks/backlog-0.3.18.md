# 0.3.18 — the backlog

Opened 2026-10-01, the day 0.3.17 went live on the Microsoft Store.

Nothing here is started. This is the list of what is genuinely open, with evidence for each
claim, so the next version begins from facts rather than from memory. Items are grouped by
whether they are **broken**, **promised**, **decided but unbuilt**, or **a question for the
owner**.

The expo is **1–4 Oct 2026**. The standing rule is no website deploys until after it.

---

## Broken — owner rules not currently met

### 1. 0.3.17 can never be offered firmware — blocks the V1.26 rollout 🛑 **FIXED, awaiting a release**

0.3.17 sends `X-PonyABC-App-Version` on the BOOK catalogue request and **nowhere else**: not on
the firmware request, not on either download. Its firmware request is byte-identical to
0.3.16's.

The server, correctly, never offers firmware to a caller that has not said it is new enough to
handle it. So **setting V1.26 to `active` would still serve `{"release": null}` to every
0.3.17 in the field** — the firmware rollout in `docs/deploy-order-content-states.md` step 4
cannot work as written. Confirmed against the live server, not inferred.

Nothing fails when this happens, which is why it survived a whole release: the app asks, the
server answers "nothing for you", and the app correctly shows no update.

**Fixed on this branch.** Every catalogue request — books, firmware, and both downloads — now
carries the version, and an Internal build with testing mode on carries the tester key on all
four. The headers are built in one guarded place (`src/main/services/catalogueRequest.ts`) and
sent **only** to the PonyABC origin, because a download URL comes out of the server's own
response and is therefore data, not a constant.

The identity is a **required** parameter rather than an optional one with a default, so the
compiler asks the question at every call site instead of a future request quietly sending
nothing again.

Still to do: the owner publishes a version containing this before V1.26 can go `active`.

### 2. No Mac builds shipped with 0.3.17 🛑

The owner's rule is that every desktop version ships Mac builds in step with Windows. 0.3.17
shipped Windows only: no Intel `.dmg`, no Apple Silicon `.dmg`, on any rc or on `v0.3.17`.

Firmware updating is Windows-only and stays Windows-only — the vendor's flashing tool is a
Windows executable. A Mac build must therefore say so plainly on the firmware screen rather
than offering something it cannot do.

**The cause is known, and it is not a broken build.** `build-mac.yml` works: it built both
architectures successfully on `main` on 2026-10-01 (run `36847118680`, `mac-arm64-installer` and
`mac-x64-installer`). It also triggers on `tags: ['v*']`, and it did run for `v0.3.17-rc1` and
`v0.3.17-rc2`, whose tags were pushed by hand.

From rc3 onwards the rc releases were cut by `workflow_dispatch` on `build-windows.yml`, which
creates the tag with `gh release create --target` (`build-windows.yml:687`). **A tag created
through the API does not fire a `push` event**, so `build-mac.yml` was never invoked for rc3,
rc4, rc5, rc6 or rc7 — and `v0.3.17` has the same gap, because that tag was created the same way.

Two things to do, in this order:

1. Make the Mac build part of cutting an rc, rather than something a side effect of tag pushing
   used to provide. Either dispatch `build-mac.yml` from the rc job, or push the tag as a tag and
   let both workflows see it. The second is simpler and restores the behaviour rc1 and rc2 had.
2. Decide what a Mac build is *for*. `electron-builder.yml:31` sets `identity: null` — there is no
   paid Apple Developer ID, so the `.dmg` is unsigned and macOS will refuse to open it without the
   user overriding Gatekeeper by hand. Shipping that to a nursery parent is worse than shipping
   nothing. Firmware updating is Windows-only regardless, since the vendor's flashing tool is a
   Windows executable, so a Mac build must say so on the firmware screen rather than offer what it
   cannot do.

DMGs for 0.3.17's exact app code already exist as artifacts of run `36847118680` — `main`'s tree
differs from `17ecd69` only in documentation and CI. They are **not** attached to the `v0.3.17`
Release, because unsigned builds are a distribution decision for the owner, not a gap to fill
quietly.

---

## Promised — shipped to customers, still owed work

### 3. Five product-name translations are mine and have had no native review ⚠️

They are on the Store now, in the listing text and in the app:

| Locale | Name as published |
|---|---|
| es | Lápiz Lector y Grabador Inteligente |
| fr | Stylo Lecteur-Enregistreur Intelligent |
| de | Intelligenter Vorlese- und Aufnahmestift |
| it | Penna Intelligente Lettore-Registratore |
| pt | Caneta Leitora e Gravadora Inteligente |

English (**Intelligent Recording Reading Pen**) and both Chinese forms (**點讀錄音筆** /
**点读录音笔**) came from the owner and are not in question.

A product name is a marketing decision, not a translation exercise. A native speaker should
confirm each reads as a product someone would buy. `PM-STATUS.md` previously said six; it is
five.

### 4. Thirteen legal strings are English only

Carried from the PM handover, 2026-10-01. The owner's interim suggestion was a translated
one-liner — "The full text is available in English" — rather than an unreviewed machine
translation of legal text. Not before the expo. Still the owner's decision: pay for
translation, or keep English with that line.

### 5. Nobody has installed 0.3.17 from the real Store 🛑

True of every release so far, including 0.3.16. Publishing is not proof the product works. The
clean-machine check in CI installs the `.appx` directly, which is not the same path a customer
takes.

Do it on a clean Windows machine — ideally the expo laptop — from the Store listing, with a real
pen. This is the single highest-value hour available.

---

## Decided but unbuilt

### 6. Library sync

Designed in `docs/design/library-sync.md`. Differential, parent-chosen, never deletes a book
that is not in the catalogue. Needs §E of `docs/test-plans/book-index-rebuild.md` run on a real
pen — does the pen ignore a hidden root folder — and roughly 1.5 days of `ponyabc-web` work,
which cannot start until after 4 Oct.

### 7. Sending the same recordings to a row of pens

Deferred to 0.3.18 by the owner during rc6. The note is already in the code, at
`src/renderer/components/AddRecordingsPanel.tsx:23`: it needs the pen-to-pen identity work
before it can be built, so one nursery can set up twenty pens without repeating itself twenty
times.

### 8. Two test plans still unrun on hardware

Both were written for 0.3.17 and neither has been executed:

- `docs/test-plans/firmware-v126-real-pen.md` — the pre-flash cleanup, and the restore when a
  flash never starts. **Shipped untested**: the code is in 0.3.17, live now.
- `docs/test-plans/book-index-rebuild.md` — rebuild timing, switching the pen off mid-rebuild, a
  `0x03` book on firmware V1.18, and §E above.

One measurement exists: the owner's pen rebuilt both `.BIN` files within seconds of power-on.
That is the only hardware evidence behind the index design.

### 9. Store screenshots were taken against a fixture, not a pen with books

The ten listing screenshots come from a 16 GB virtual volume with a fixture pen folder. The
space figures are honest readings of a real volume of the right size, but no screenshot shows
the app with a shelf of real books on a real pen. Recapture on hardware when one is free.

---

## Questions for the owner

### 10. Firmware publishing is unblocked at the server — but not at the app (see item 1)

The condition was 0.3.17 being live in the Store. It is. **But item 1 means no 0.3.17 would be
told about it anyway**, so setting V1.26 active today changes nothing for anyone and risks
only confusion. The real gate is now a released build that sends the version header.

The firmware row in `ponyabc-web` is still `inactive` and nothing has been changed.

The cost of turning it on today: every 0.3.16 still in the field gets offered an upgrade that
runs without the pre-flash cleanup and silently does not take effect. Store rollout reaches
machines over hours. Recommendation: leave it until after the expo.

### 11. "WILL REPLACE" in capitals, on a parent-facing screen

`addFromComputer.willReplace` renders in `AddRecordingsPanel`, which is parent-facing — it was
promoted out of Advanced in rc6 at the owner's request. The words are plain English, not
technical, so it does not break the product principle; the capitals are deliberate emphasis on
the one irreversible thing in that panel. Keep or soften — a wording call, not a defect.

---

## Checked and closed — no action

Recorded here so they are not re-raised.

- **Is `bookRemove` reachable from a parent button?** No. Its only renderer route is the sync
  batch (`BookLibraryScreen.tsx:295`), and `buildSyncPlan` only puts a book in `toRemove` when
  the catalogue marks it `remove_from_pens` **and** the file on the pen matches both the
  filename and the exact size (`src/shared/bookSyncPlan.ts:96-110`). There is no parent-facing
  delete anywhere.
- **Are "Verify", "Checking this file…" and "checksum" visible to parents?** No. `action.verifyThis`,
  `action.verifyWorking` and every `status*` string containing "checksum" render only inside
  `<AdvancedDetails>` (`BookLibraryScreen.tsx:635`) — one disclosure away, where support needs
  them.
