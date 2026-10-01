# Real-pen test — the pen's book list (index) rebuild

For 0.3.17. Four questions we cannot answer without hardware. Each has a place to write the
answer, because the answers change what the app should tell a parent.

Background, established 2026-09-29: `BOOK/BOOKFILE.BIN` is written by the pen itself on
power-on, one 44-byte record per `.axb`, and a book is found by its **position** in that list.
`BOOK/1.BIN` is a zero-byte marker; while both exist the pen trusts the list and does not rebuild
it. The app deletes both after **any sync that wrote a book at all** — added or replaced — and
after a removal, so the pen rebuilds on its next start. (Owner decision, 2026-09-30; until then a
same-name replacement left the list alone.)

Use a pen you can afford to reset, and note its firmware version before you start.

---

## A. How long does a rebuild actually take?

With about 38 books on the pen — this is the number that decides whether "may take a little
longer" is honest or an understatement.

**This now matters for every sync, not just for an added book.** Since 2026-09-30 an
update-only sync ends the same way, so whatever this rebuild costs, a parent pays it every time
they sync anything at all. If it turns out to be slow, that is an argument about the wording, and
possibly about the rule — report the number either way.

1. [ ] Connect the pen, and in the app add one book. Wait for "All done!".
2. [ ] Unplug, then switch the pen **off and on**.
3. [ ] **Start a timer at power-on** and stop it when the pen responds to a page touch.

|                                              |      |
| -------------------------------------------- | ---- |
| Books on the pen                             | ____ |
| Time from power-on to first response         | ____ |
| Any sound, light or sign that it is working? | ____ |
| Does it look broken while it happens?        | ____ |

### A2. The same, after an update-only sync

The new case. Nothing was added; one book was replaced under its own name.

1. [ ] With every catalogue book already on the pen, make one of them need updating (ask for a
       re-issued edition, or use a build where one book's size differs) and sync.
2. [ ] Check the app said **"All done!"** and asked for a restart — an update-only sync must no
       longer end quietly.
3. [ ] Unplug, power-cycle, and time it exactly as in A.

|                                                       |      |
| ----------------------------------------------------- | ---- |
| Time from power-on to first response                  | ____ |
| Same as A, or noticeably different?                   | ____ |
| Do all books still play, including the updated one?   | ____ |

**If this is more than about 20 seconds**, the message needs to say so plainly, and the answer
belongs in the wording rather than in a doc.

---

## B. What if the pen is switched off _during_ the rebuild?

The case that worries me most: a parent sees nothing happening and assumes it has hung.

1. [ ] Add a book in the app, unplug, and power the pen on.
2. [ ] **Switch it off again part-way through the rebuild** (use the timing from A — aim for
       halfway).
3. [ ] Switch it on again and let it finish.

|                                                                              |      |
| ---------------------------------------------------------------------------- | ---- |
| Does it recover on the next start?                                           | ____ |
| Does it take the full rebuild time again, or resume?                         | ____ |
| Do all books still play afterwards — including the new one?                  | ____ |
| Is `BOOKFILE.BIN` present and the right size afterwards? (connect and check) | ____ |

**If it does not recover**, we must warn before the restart, not after, and the wording changes
from "may take a little longer" to "please leave it on until it finishes".

---

## C. On an already-upgraded pen, add a book **without** deleting the list

This is what every version before 0.3.17 did, and it is the bug we are fixing. Worth seeing
once, so we know what a customer would report.

1. [ ] On a pen already running V1.26, copy a `.axb` into `BOOK\` **with Explorer/Finder**, not
       with the app, leaving `1.BIN` and `BOOKFILE.BIN` in place.
2. [ ] Unplug, restart the pen, and try the new book.

|                                                                   |      |
| ----------------------------------------------------------------- | ---- |
| Does the new book play at all?                                    | ____ |
| Do the **existing** books still play the right audio?             | ____ |
| If you then open the app, does it offer "Fix my pen's book list"? | ____ |
| After using that fix and restarting, does everything play?        | ____ |

The last two lines are the self-heal feature being tested end to end.

---

## D. On a **V1.18** pen, add `phonics card.axb` and delete the list

`phonics card.axb` carries `0x03` in record byte 3 where the other 37 books carry `0x02` — a
different record type, which may or may not need V1.26. This is the test that tells us.

1. [ ] Start from a pen still on **V1.18**.
2. [ ] Add `phonics card.axb` using the app (which deletes the list for you).
3. [ ] Unplug, restart, and try the new book.

|                                                                 |       |
| --------------------------------------------------------------- | ----- |
| Firmware version on the pen                                     | V1.18 |
| Does `phonics card` play on V1.18?                              | ____  |
| Do the other books still play correctly?                        | ____  |
| If it does **not** play, does it work after upgrading to V1.26? | ____  |

**If a `0x03` book needs V1.26**, the catalog has to say so per book (`min_firmware_version`),
and the app must refuse to add it to an older pen rather than leaving a parent with a book that
does nothing. That would be a new requirement, not a bug in what is built.

---

## E. Does the pen ignore a hidden folder at the card root?

Needed before the library sync is built (`docs/design/library-sync.md` §1). The app wants to keep
a small sync record on the card, outside `BOOK/`. The firmware references only `BOOK`, `diy`,
`RECORD` and `System`, but the card also holds music folders the pen browses somehow, so a new
root folder is not provably invisible.

1. [ ] With the pen connected, create a folder `.ponyabc` at the **root of the card** and put a
       small text file in it named `sync.json`.
2. [ ] Unplug, restart the pen, and use it normally for a minute — books and the music folders.

|                                                  |      |
| ------------------------------------------------ | ---- |
| Does anything new appear in the pen's own menus? | ____ |
| Does the pen announce or try to play it?         | ____ |
| Do books and recordings still work normally?     | ____ |
| Is the file still there afterwards, unchanged?   | ____ |

**If anything appears**, the record goes in `BOOK/ponyabc-sync.json` instead — which we know is
ignored, since the index counts only `.axb` and the scanner reads only five extensions.

---

## Reporting

Settings → export diagnostics and send the file. It carries a `book-index-reset` entry for every
decision the app made, so "it did not rebuild" can be checked against whether we actually deleted
the files, without guessing.
