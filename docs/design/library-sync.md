# Design — "Sync with the PonyABC library"

**Status: design only, for 0.3.18. No code. `ponyabc-web` work starts after 4 Oct.**

Owner decisions this is built on (2026-09-29):

- A book is only usable with its **physical card set**. Which books are sold is the owner's call.
- Sync is **parent-chosen**: the parent picks the books they own cards for. Never add everything.
- Books not in the PonyABC catalog are **unsupported**: never modified, never offered, left alone.
- Parents **add and update**; they do not remove. Removal belongs to the library.

## The constraint that shapes everything

The pen's USB is **1.x**. Measured: a full-card `dd` image ran at **978 kB/s**.

|                                     |                         |
| ----------------------------------- | ----------------------- |
| One 1.1 GB book                     | **~19 minutes**         |
| Re-copying a full 16 GB card        | **over 4½ hours**       |
| Verifying a book by reading it back | **another ~19 minutes** |

So the design is not "sync, and optimise later". **Never re-copy or read back a whole book unless
we have decided it must change.** Every rule below follows from that one sentence.

---

## 1. Deciding what to do, without reading the pen

For each catalog book the parent has chosen, we must answer "is the right version already there?"
using only cheap facts.

**Cheap:** a directory listing of `BOOK/` — filename, size, modified time. A `stat`, not a read.
**Not cheap:** hashing a book on the pen. Nineteen minutes each. Never during a sync.

### The sync record

The app writes a small record of what it last put on the pen:

```jsonc
// /.ponyabc/sync.json   (see "Where it lives" below)
{
  "version": 1,
  "penVolumeLabel": "PONYABC",
  "books": {
    "0451.axb": {
      "contentId": "…",
      "catalogVersionId": "…",
      "sha256": "…", // the catalog's hash for the version we wrote
      "sizeBytes": 1124073472,
      "writtenAtMs": 1790000000000,
    },
  },
}
```

Decision table per chosen book:

| Record says                                                 | Pen listing says                  | Do                                      |
| ----------------------------------------------------------- | --------------------------------- | --------------------------------------- |
| this version, size matches                                  | present, same size                | **nothing**                             |
| an older version                                            | present                           | **update** (same-name replace)          |
| nothing (factory-preloaded, or written by another computer) | present, **size matches** catalog | **nothing** — assume it is that version |
| nothing                                                     | present, **size differs**         | **update**                              |
| —                                                           | absent                            | **add**                                 |

The third row is the fallback the owner asked for, and it is a judgement call worth naming: a
factory-preloaded book whose size matches the catalog is _probably_ that version, and the
alternative — hashing it — costs nineteen minutes to confirm something that is almost always
true. If a parent ever reports a book behaving oddly, the existing per-book **Verify** under
Advanced details does the expensive check on demand, for that one book.

**Never delete-and-recopy.** An update is a same-name replace, which also keeps the book's
position and so needs no index reset (unless `update_requires_index_reset` is set — see
`book-index-reset-catalog.md`).

### Where the record lives

The owner asked for it outside `BOOK/`. Proposed: **`/.ponyabc/sync.json`** at the card root.

What I can confirm from `app.bin`: the firmware references exactly four directories —
`BOOK`, `diy`, `RECORD`, `System` — and in `BOOK` it scans only `.axb .ax1 .smp .dic .bnf`.
A `.json` in a dot-directory matches nothing it looks for.

What I **cannot** confirm from strings alone: whether the pen's general media browsing enumerates
arbitrary root folders. The card also holds `粤语`, `白噪音`, `我的收藏`, `普通话`, `English`,
which the pen plainly browses somehow, so a new root folder is not provably invisible.

**This needs one real-pen check before implementation** (added to the test plan): create
`/.ponyabc/sync.json`, restart the pen, and confirm nothing new appears and nothing misbehaves.

**Evidence-backed fallback if it does appear:** `BOOK/ponyabc-sync.json`. We _know_ the index
counts only `.axb` (37 `.axb` + `english.dic` = 37 records) and the scanner looks only at those
five extensions, so a `.json` there is ignored by both. It sits in `BOOK/`, which is untidy, but
it is the option we have evidence for rather than hope.

---

## 2. What sync touches, and what it must never touch

**Touches:** catalog books the parent has chosen, in `BOOK/`, by name.

**Never touches:**

- **Books not in the catalog.** Including the China-market books a customer bought elsewhere.
  The app does not modify them, does not offer to, and does not count them as a problem. Help
  text says so plainly: _"Only PonyABC books can be added or updated here. Any other books on
  your pen are left exactly as they are."_
- **DIY recordings** — a different feature, and often the only copy of a grandparent's voice.
- **`english.dic`**, `System/`, `RECORD/`, and the music folders.
- **The index files**, except by the existing rule (add/remove → reset once, at the end).

---

## 3. Catalog states

| State                | Not on the pen        | Already on the pen                  |
| -------------------- | --------------------- | ----------------------------------- |
| **active**           | offered to the parent | kept up to date                     |
| **retired**          | **not offered**       | **kept, and still updated**         |
| **remove_from_pens** | not offered           | **removed**, and the parent is told |

**Retired is the important one.** A customer owns the physical cards; a book leaving the
catalogue does not make their cards stop existing. Removing it from their pen would break a
product they paid for. So retired means "we no longer sell it", not "take it away".

**`remove_from_pens` is for the rare, real cases** — a licensing withdrawal, or content that must
not remain. It removes the file, lists it to the parent in plain words (_"One book was removed
from your pen at the publisher's request: …"_), and triggers an index reset, because a removal
shifts every later book's position.

### The 37 China-edition books

**Retired by default** when the international library replaces them. They stay on every pen that
has them and keep working; they are simply not offered to new pens. Anything stronger would take
books off the pens of customers who own those cards.

---

## 4. Parent-chosen, not automatic

The parent picks the books they own cards for. The screen is a list of catalog books with a
checkbox and a size, a running total, and a time estimate that updates as they tick.

```
┌ Add books to your pen ─────────────────────────────────────────┐
│  Choose the books whose cards you have.                        │
│                                                                │
│  ☑ Phonics Cards            288 MB   On your pen               │
│  ☑ Nursery Rhymes           1.1 GB   Not on your pen yet       │
│  ☐ World Geography          107 MB   Not on your pen yet       │
│                                    ┆ Don't have the cards?     │
│                                    ┆ [Where to buy]            │
│                                                                │
│  Selected: 1.1 GB · about 20 minutes                           │
│  Space on your pen: 9.4 GB free                                │
│                          [Cancel]  [Add to my pen]             │
└────────────────────────────────────────────────────────────────┘
```

### "Where to buy" — design, not yet a decision

A catalog field `shop_url` per book, pointing at the PonyABC Shopify product page. Shown only
against a book the parent has **not** selected and does **not** have, as a quiet link — never a
banner, never on a book they own.

Wording: **"Don't have the cards? Where to buy"** (繁：「未有呢套卡？前往購買」→ standard written:
**「未有這套卡？前往購買」**). Placement: inline on the book's row, under Advanced-free plain text,
so it reads as help rather than an advert in a product a nursery has already paid for.

If `shop_url` is absent the link simply does not appear, so this can ship before the shop links
exist.

---

## 5. Transfer, at 1 MB/s

- **Total estimate before starting**, from the sum of selected sizes at 978 kB/s, rounded up.
  Already built for the single-book case (`penTransferEstimate.ts`) and reused as-is.
- **One book at a time**, in size order, smallest first — so a parent sees something finish early
  rather than staring at a 19-minute bar.
- **Cancel between books.** Not mid-book: a cancelled part-written file is exactly what the
  staged-write design exists to avoid, and the staged file is discarded on failure anyway.
  The button reads "Stop after this book".
- **Resume a large interrupted copy.** The staged file (`.ponyabc-tmp-…​.part`) survives a crash.
  On the next sync, if a staged file exists for the same target and its size is less than the
  expected size, continue appending from its length **and then verify the whole staged file
  against the catalog hash before renaming**. Resuming is only safe _because_ the final check is
  a full hash — the one place where reading back is worth the time, since the alternative is
  re-copying from zero.
- **Free space check** against the 16 GB card before starting, counting only what will actually
  be written (an update of a same-size book frees what it replaces).

---

## 6. What `ponyabc-web` needs

| Field                                                           | Where              | Why                                                                                                |
| --------------------------------------------------------------- | ------------------ | -------------------------------------------------------------------------------------------------- |
| `lifecycle_state` — `active` \| `retired` \| `remove_from_pens` | `content_items`    | §3. Default `active`.                                                                              |
| `catalog_version_id`                                            | `content_versions` | A stable id for "which version is on the pen", so the sync record does not have to compare hashes. |
| `update_requires_index_reset`                                   | `content_versions` | Already designed and already read by the app.                                                      |
| `shop_url`                                                      | `content_items`    | §4. Nullable; absent means no link.                                                                |
| `min_app_version`                                               | `content_versions` | Same reasoning as firmware: a book needing a newer app must not be offered to an older one.        |

`GET /api/public/books` gains `lifecycleState`, `catalogVersionId`, `shopUrl`, and continues to
omit anything the app does not need. **Retired books must still be returned** — the app needs them
to keep an already-installed copy updated — with their state, so the app can decline to offer
them. That is the one API change that is easy to get wrong.

---

## 7. Effort

|                                                                     |           |
| ------------------------------------------------------------------- | --------- |
| Sync record: write, read, migrate, per-pen keying                   | ~1 day    |
| Decision engine + tests against real temp directories               | ~1.5 days |
| Selection screen, estimates, free space, shop link                  | ~1.5 days |
| Resume + verification of a part-written file                        | ~1 day    |
| Lifecycle states, including the retired/remove wording in 8 locales | ~1 day    |
| `ponyabc-web`: migration, API, admin                                | ~1.5 days |
| Real-pen testing at 1 MB/s (mostly waiting)                         | ~1 day    |

**~8.5 days**, of which ~1.5 is web. Nothing here is on the expo's path.

## 8. Open, and worth deciding before building

1. **Does the pen ignore `/.ponyabc/`?** One real-pen check. Everything else is settled either
   way, because the fallback is evidence-backed.
2. **Is a size match enough** for a factory-preloaded book, or should the first sync hash them
   once (37 books ≈ 4½ hours, once per pen)? My recommendation: size match, with per-book Verify
   on demand. Hashing 37 books to confirm something almost always true is a poor trade at 1 MB/s.
3. **Does `remove_from_pens` need a parent's confirmation**, or is the publisher's instruction
   enough? I would confirm — it is the only case where sync deletes something.
