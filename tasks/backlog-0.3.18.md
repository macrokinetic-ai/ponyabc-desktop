# 0.3.18 — the backlog

Opened 2026-10-01, the day 0.3.17 went live on the Microsoft Store.

Nothing here is started. This is the list of what is genuinely open, with evidence for each
claim, so the next version begins from facts rather than from memory. Items are grouped by
whether they are **broken**, **promised**, **decided but unbuilt**, or **a question for the
owner**.

The expo is **1–4 Oct 2026**. The standing rule is no website deploys until after it.

---

## Broken — owner rules not currently met

### 1. No Mac builds shipped with 0.3.17 🛑

The owner's rule is that every desktop version ships Mac builds in step with Windows. 0.3.17
shipped Windows only: no Intel `.dmg`, no Apple Silicon `.dmg`, on any rc or on `v0.3.17`.

Firmware updating is Windows-only and stays Windows-only — the vendor's flashing tool is a
Windows executable. A Mac build must therefore say so plainly on the firmware screen rather
than offering something it cannot do.

- `build-mac.yml` exists and its attach step now runs on `-rc` tags.
- What is unknown: whether the workflow currently produces both architectures, and whether the
  app's firmware screen degrades honestly on macOS. Neither has been checked on a Mac.
- Do this before anything cosmetic. It is a rule already broken, not a feature.

---

## Promised — shipped to customers, still owed work

### 2. Five product-name translations are mine and have had no native review ⚠️

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

### 3. Thirteen legal strings are English only

Carried from the PM handover, 2026-10-01. The owner's interim suggestion was a translated
one-liner — "The full text is available in English" — rather than an unreviewed machine
translation of legal text. Not before the expo. Still the owner's decision: pay for
translation, or keep English with that line.

### 4. Nobody has installed 0.3.17 from the real Store 🛑

True of every release so far, including 0.3.16. Publishing is not proof the product works. The
clean-machine check in CI installs the `.appx` directly, which is not the same path a customer
takes.

Do it on a clean Windows machine — ideally the expo laptop — from the Store listing, with a real
pen. This is the single highest-value hour available.

---

## Decided but unbuilt

### 5. Library sync

Designed in `docs/design/library-sync.md`. Differential, parent-chosen, never deletes a book
that is not in the catalogue. Needs §E of `docs/test-plans/book-index-rebuild.md` run on a real
pen — does the pen ignore a hidden root folder — and roughly 1.5 days of `ponyabc-web` work,
which cannot start until after 4 Oct.

### 6. Sending the same recordings to a row of pens

Deferred to 0.3.18 by the owner during rc6. The note is already in the code, at
`src/renderer/components/AddRecordingsPanel.tsx:23`: it needs the pen-to-pen identity work
before it can be built, so one nursery can set up twenty pens without repeating itself twenty
times.

### 7. Two test plans still unrun on hardware

Both were written for 0.3.17 and neither has been executed:

- `docs/test-plans/firmware-v126-real-pen.md` — the pre-flash cleanup, and the restore when a
  flash never starts. **Shipped untested**: the code is in 0.3.17, live now.
- `docs/test-plans/book-index-rebuild.md` — rebuild timing, switching the pen off mid-rebuild, a
  `0x03` book on firmware V1.18, and §E above.

One measurement exists: the owner's pen rebuilt both `.BIN` files within seconds of power-on.
That is the only hardware evidence behind the index design.

### 8. Store screenshots were taken against a fixture, not a pen with books

The ten listing screenshots come from a 16 GB virtual volume with a fixture pen folder. The
space figures are honest readings of a real volume of the right size, but no screenshot shows
the app with a shelf of real books on a real pen. Recapture on hardware when one is free.

---

## Questions for the owner

### 9. Firmware publishing is now unblocked

The condition was 0.3.17 being live in the Store. It is. The firmware row in `ponyabc-web` is
still `inactive` and nothing has been changed.

The cost of turning it on today: every 0.3.16 still in the field gets offered an upgrade that
runs without the pre-flash cleanup and silently does not take effect. Store rollout reaches
machines over hours. Recommendation: leave it until after the expo.

### 10. "WILL REPLACE" in capitals, on a parent-facing screen

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
