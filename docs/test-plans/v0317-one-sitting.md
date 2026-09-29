# v0.3.17 — one testing session

Everything worth learning from a real pen, in one sitting, highest-risk first.

**Total: about 2 hours 15 minutes**, of which roughly 50 minutes is waiting for copies at the
pen's ~1 MB/s. Bring something else to do during steps 3 and 7.

## Before you start

|                          |                                                                                                                  |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| **PC**                   | A test Windows PC, **not the expo demo laptop**. See `v0317-test-build-install.md`.                              |
| **Pen**                  | A **test pen**, not a demo pen. It will be wiped and restored.                                                   |
| **Have ready**           | An SD-card image of the test pen (to restore it afterwards), the V1.26 firmware package, and `phonics card.axb`. |
| **Write down as you go** | Every ____ in this document. If a step surprises you, note what you saw rather than what you expected.           |

**Restoring the pen afterwards:** take the card out, write your saved image back to it with the
same tool you used to make it (Raspberry Pi Imager, balenaEtcher, or `dd`), and put it back. A
full 16 GB card takes **over four hours** at this speed — start it when you finish and leave it
overnight. If you would rather not, note that the pen is left with whatever the tests put on it.

---

# Part 1 — the two that could change what we build (≈35 min)

These are first because a bad answer here changes the design, not just the code.

## Step 1 — switching the pen off DURING a rebuild (≈15 min)

_Index test B. The one I am most worried about: a parent who sees nothing happening assumes it
has hung and pulls the plug._

1. [ ] Connect the pen. In **BOOK Library**, add one small book (pick the smallest in the list).
2. [ ] Wait for **"All done!"**, then unplug.
3. [ ] Switch the pen on. **Start a timer.**
4. [ ] Part-way through — about halfway to whatever step 2 measures, or 20 seconds if you have
       not done step 2 yet — **switch it off again.**
5. [ ] Switch it on once more and let it finish completely.

|                                                            |      |
| ---------------------------------------------------------- | ---- |
| Did it recover on the next start?                          | ____ |
| Did it take the full time again, or resume?                | ____ |
| Do all books play afterwards, including the new one?       | ____ |
| Reconnect: are `1.BIN` and `BOOKFILE.BIN` back in `BOOK\`? | ____ |

**If it does not recover:** stop and tell me. The warning has to move _before_ the restart and
change from "may take a little longer" to "please leave it on until it finishes".

## Step 2 — how long a rebuild actually takes (≈10 min)

_Index test A. This decides whether our wording is honest._

1. [ ] With ~38 books on the pen, add one more book in the app.
2. [ ] Unplug, power on, **time from switch-on to the pen answering a page touch.**

|                                         |      |
| --------------------------------------- | ---- |
| Books on the pen                        | ____ |
| Seconds from power-on to first response | ____ |
| Any sound or light while it works?      | ____ |
| Does it look broken while it happens?   | ____ |

**If it is more than about 20 seconds**, tell me — the message needs rewording.

## Step 3 — `phonics card.axb` on a V1.18 pen (≈10 min + copy time)

_Index test D. This one may turn into a new requirement._

`phonics card.axb` is a different record type (`0x03`) from the 37 existing books (`0x02`). We do
not know whether it needs V1.26.

1. [ ] Start from a pen still on **V1.18** (check the version before you begin: ____).
2. [ ] Add `phonics card.axb` through the app. **288 MB ≈ 5 minutes** to copy.
3. [ ] Unplug, restart, and try the new book.

|                                                                             |      |
| --------------------------------------------------------------------------- | ---- |
| Does _phonics card_ play on V1.18?                                          | ____ |
| Do the other books still play correctly?                                    | ____ |
| If it does **not** play — does it work after you upgrade to V1.26 (step 4)? | ____ |

**If a `0x03` book needs V1.26**, the catalogue needs a per-book minimum firmware version and the
app must refuse to add it to an older pen. That is new work, not a bug.

---

# Part 2 — the firmware upgrade (≈30 min)

## Step 4 — cancel the Windows prompt (≈10 min)

_The most likely thing a real customer does by accident, and the path 0.3.17 added._

1. [ ] Note what is in `BOOK\` first — is `1.BIN` there? `BOOKFILE.BIN`? Sizes: ____
2. [ ] **Firmware** → select the V1.26 package → Next → **Start upgrade**.
3. [ ] When Windows asks permission, click **No**.

|                                                                              |      |
| ---------------------------------------------------------------------------- | ---- |
| Does the app say the update did not finish and the pen has not been changed? | ____ |
| Does it avoid mentioning any filenames?                                      | ____ |
| Are `1.BIN` and `BOOKFILE.BIN` **back**, same sizes as before?               | ____ |
| Unplug, power-cycle: do a book and a recording still play?                   | ____ |

The pen should be **indistinguishable from one that was never plugged in**.

## Step 5 — the real upgrade (≈15 min)

1. [ ] Run the upgrade again and this time **approve** the prompt.
2. [ ] Before rebooting the pen, look in `BOOK\`: `1.BIN` and `BOOKFILE.BIN` should be **gone**.
3. [ ] Every `.axb` and every DIY recording should still be there.
4. [ ] Unplug, power-cycle, and check the version now reads **V1.26**: ____
5. [ ] Reconnect and check `BOOK\` again — the two files should be **back** (the pen rebuilds
       them): ____
6. [ ] Play a book and a DIY recording made **before** the upgrade: ____

**If a book that worked before is now silent, stop and tell me the filename.** That is the most
important possible result of this session.

## Step 6 — a second upgrade in a row (≈5 min)

1. [ ] Run the V1.26 upgrade again on the same pen, changing nothing.
2. [ ] It should complete normally: ____

---

# Part 3 — books (≈40 min)

## Step 7 — add a large book and watch the estimate (≈25 min)

1. [ ] Pick a book of about 1 GB. Before it starts, the app says **"about ___ minutes"**.
2. [ ] Start it and note the real time: ____ minutes.

|                                                                        |      |
| ---------------------------------------------------------------------- | ---- |
| Was the estimate close, and never optimistic?                          | ____ |
| Did the progress bar move steadily?                                    | ____ |
| Did "time remaining" settle down and count down sensibly?              | ____ |
| Did the PC stay awake on its own?                                      | ____ |
| Did the "Please don't unplug your pen" notice stay visible throughout? | ____ |

## Step 8 — update a book you already have (≈10 min)

1. [ ] Pick a book already on the pen and choose **Update**, then **Replace**.

|                                                                    |      |
| ------------------------------------------------------------------ | ---- |
| Does it finish and say **"All done! Your book has been updated."** | ____ |
| Does it **not** tell you to restart the pen?                       | ____ |
| Does that book still play without restarting?                      | ____ |

_A same-name replacement keeps the book's position, so no restart is needed. If it asks you to
restart, that is a bug — tell me._

## Step 9 — "Fix my pen's book list" (≈5 min)

1. [ ] Close the app. In File Explorer, **copy any `.axb` into `BOOK\` by hand** (or delete one —
       keep a copy).
2. [ ] Open the app and connect the pen.

|                                                                 |      |
| --------------------------------------------------------------- | ---- |
| Does it offer **"Fix my pen's book list"**?                     | ____ |
| Does it do nothing until you press it?                          | ____ |
| After pressing it and restarting the pen, does everything play? | ____ |

## Step 10 — you cannot delete a book (≈1 min)

1. [ ] Look over the BOOK Library screen with books on the pen.

|                                                                        |      |
| ---------------------------------------------------------------------- | ---- |
| Is there **any** way to remove or delete a book? There should be none. | ____ |

---

# Part 4 — recordings (≈20 min)

## Step 11 — back up, restore, rename, change sticker

1. [ ] **My Recordings** → **Back up my recordings**. Time taken: ____
2. [ ] **Rename** one recording. Does it say the name is only on this computer? ____
3. [ ] Record something new on the pen over an existing sticker number, reconnect, then
       **Put these back on my pen** from the backup.

|                                                                          |      |
| ------------------------------------------------------------------------ | ---- |
| Does it show a conflict and offer **both** recordings to listen to?      | ____ |
| Do both play?                                                            | ____ |
| Does it refuse to continue until you choose?                             | ____ |
| After choosing "use the backup", is the pen's old one still in a backup? | ____ |

4. [ ] **Change sticker number** on a recording. Type `451` (three digits).

|                                                                    |      |
| ------------------------------------------------------------------ | ---- |
| Does it refuse and explain, rather than silently making it `0451`? | ____ |

5. [ ] Now type a proper 4-digit number and confirm the recording moves: ____
6. [ ] **Delete from pen** one recording. Does it confirm first, and say a copy is kept? ____

---

# Part 5 — the hidden folder (≈5 min)

## Step 12 — does the pen ignore `/.ponyabc/`?

_Needed before the library sync can be built._

1. [ ] With the pen connected, create a folder called `.ponyabc` at the **top level of the pen's
       drive** and put any small text file in it called `sync.json`.
2. [ ] Unplug, restart the pen, and use it normally for a minute.

|                                              |      |
| -------------------------------------------- | ---- |
| Does anything new appear in the pen's menus? | ____ |
| Does the pen try to play or announce it?     | ____ |
| Do books and recordings still work normally? | ____ |
| Is the file still there afterwards?          | ____ |

---

# Finishing up

## Send me the diagnostics

1. [ ] In the app: **Settings** → **Export diagnostics**.
2. [ ] It saves a file and shows you where. Send me that file.

It carries a record of every decision the app made — every firmware session, every book-index
reset, every write — so "it didn't rebuild" or "it said it worked" can be checked rather than
guessed at.

## Restore the pen

- [ ] Write your saved SD image back to the card (over four hours — leave it running), **or**
- [ ] note here that the pen was left as the tests left it: ____

## The three answers I most want

1. **Step 1** — does the pen recover if switched off mid-rebuild?
2. **Step 3** — does `phonics card.axb` play on V1.18?
3. **Step 5** — does anything that worked before the firmware upgrade stop working after it?
