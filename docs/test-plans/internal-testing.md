# Internal testing on the Windows test PC

For **v0.3.17-rc4 and later**, using the **Internal build**. Everything here happens on a test
pen you can afford to reset. Nothing here touches the Microsoft Store, and nothing is submitted.

The Internal build says **INTERNAL TEST BUILD — not for customers** across the top of every
screen, and Settings → Version reads `0.3.17 (rc4, <commit>) · Internal`. If you cannot see
both of those, you are in the Store build and none of this will be there.

---

## 1. Set up the test catalogue folder

Copy these four files from `ponyabc-desktop/source/` onto the Windows PC, into one folder —
say `C:\PonyABC-test\`:

| File | What it is |
|---|---|
| `phonics card.axb` | 287.6 MB |
| `英语儿歌卡.axb` | 65.8 MB |
| `英语指令卡.axb` | 21.1 MB |
| `pen-AC6966-V1.26-20260924-vddio-3400-Rectail-500-pause-bnf-ble-SD.zip` | the V1.26 firmware |

Then save the manifest below beside them as `manifest.json`. It adds those three books and
marks the seven Mandarin books to come off the pen.

```json
{
  "books": [
    {
      "id": "test-phonics",
      "originalFileName": "phonics card.axb",
      "friendlyName": "Phonics & Colour Cards",
      "friendlyNameI18n": {
        "en": "Phonics & Colour Cards",
        "zh": "自然拼读与颜色卡",
        "yue": "自然拼讀及顏色卡"
      },
      "contentLanguages": ["zh", "en", "yue"],
      "sizeBytes": 301559352,
      "sha256": "9cbf1e28c159f1cbec8442753c61ee992dcce804fa28256ce38b386ec91f809a",
      "sortOrder": 100,
      "state": "active",
      "file": "phonics card.axb"
    },
    {
      "id": "test-nursery-rhymes",
      "originalFileName": "英语儿歌卡.axb",
      "friendlyName": "English Nursery Rhymes Cards",
      "friendlyNameI18n": { "en": "English Nursery Rhymes Cards", "zh": "英语儿歌卡", "yue": "英語兒歌卡" },
      "contentLanguages": ["en"],
      "sizeBytes": 68983912,
      "sha256": "6af603e077ab893f9a21056424a46f2c5400da0497910b1e63aaed8b66a98a00",
      "sortOrder": 101,
      "state": "active",
      "file": "英语儿歌卡.axb"
    },
    {
      "id": "test-instruction-cards",
      "originalFileName": "英语指令卡.axb",
      "friendlyName": "English Instruction Cards",
      "friendlyNameI18n": { "en": "English Instruction Cards", "zh": "英语指令卡", "yue": "英語指令卡" },
      "contentLanguages": ["zh", "en"],
      "sizeBytes": 22145488,
      "sha256": "ba51e125205c4bc1a8717d5d5e4055fb2690ad1e14e5ff74ad3148da8ab3837b",
      "sortOrder": 102,
      "state": "active",
      "file": "英语指令卡.axb"
    },

    { "id": "live-hanyu-pinyin",  "originalFileName": "汉语拼音卡.axb",   "friendlyName": "汉语拼音卡",   "sizeBytes": 25034216,  "state": "remove_from_pens" },
    { "id": "live-tongxing",      "originalFileName": "童行永庆坊.axb",   "friendlyName": "童行永庆坊",   "sizeBytes": 155148928, "state": "remove_from_pens" },
    { "id": "live-xiangsheng",    "originalFileName": "童谣姐姐相声卡.axb", "friendlyName": "童谣姐姐相声卡", "sizeBytes": 712729720, "state": "remove_from_pens" },
    { "id": "live-gushi",         "originalFileName": "童谣姐姐古诗卡.axb", "friendlyName": "童谣姐姐古诗卡", "sizeBytes": 122189808, "state": "remove_from_pens" },
    { "id": "live-tongyao",       "originalFileName": "童谣姐姐童谣卡.axb", "friendlyName": "童谣姐姐童谣卡", "sizeBytes": 188956352, "state": "remove_from_pens" },
    { "id": "live-pony-gushi",    "originalFileName": "Pony古诗卡.axb",   "friendlyName": "Pony古诗卡",   "sizeBytes": 125899960, "state": "remove_from_pens" },
    { "id": "live-guoxue",        "originalFileName": "国学启蒙卡.axb",   "friendlyName": "国学启蒙卡",   "sizeBytes": 824901496, "state": "remove_from_pens" }
  ],
  "firmware": [
    {
      "id": "test-v126",
      "version": "AC6966-V1.26",
      "hardwareRev": "v1",
      "sizeBytes": 49605426,
      "sha256": "14cc6ca6e86badc95c0f96f3b55d5f836c83461d3d37870aa18486efa2ad6ec6",
      "state": "active",
      "file": "pen-AC6966-V1.26-20260924-vddio-3400-Rectail-500-pause-bnf-ble-SD.zip"
    }
  ]
}
```

The seven `remove_from_pens` sizes are the live catalogue's, to the byte. **That matters**: the
app only removes a book when the filename *and* the size match, so a wrong size here means
nothing is removed, which is the safe way round.

Then in the app: **Settings → Testing mode**, tick it on, and choose that folder.

## 2. Before you start

Note down, with the pen connected:

|  |  |
|---|---|
| Books on the pen | ____ |
| Free space on the pen | ____ |
| App version shown in Settings | ____ |

## 3. The checks

### A. Removal frees the space it said it would

1. [ ] Open **BOOK Library**. Before pressing anything, it should say **"7 books will be taken
       off your pen"** and name them, with **about 2.1 GB** freed.
2. [ ] Note the free space, press **Sync books**, and wait.
3. [ ] When it finishes, note the free space again.

|  |  |
|---|---|
| Said it would free | ____ |
| Actually freed | ____ |
| Any book removed that was NOT in the list? | ____ |
| Are the DIY recordings all still there? | ____ |
| Is `english.dic` still there? | ____ |

**If anything outside the list was removed, stop and report it.** That is the one failure in
this plan that must never happen.

### B. The new books play, after the restart

1. [ ] The sync should end with **"All done!"** and ask you to restart the pen.
2. [ ] Unplug, switch off and on, and wait for the pen to respond.
3. [ ] Touch each of the three new books.

|  |  |
|---|---|
| Time from power-on to first response | ____ |
| Phonics & Colour Cards plays | ____ |
| English Nursery Rhymes Cards plays | ____ |
| English Instruction Cards plays | ____ |
| Does any book play the WRONG audio? | ____ |

A book playing the wrong audio means the pen's list and its books disagree — report it
immediately, with which book and what it said.

### C. "Fix my pen's book list" is not offered afterwards

1. [ ] Plug the pen back in and open **BOOK Library**.
2. [ ] It should **not** offer *Fix my pen's book list*.

If it does, the rebuild did not finish, or the pen was unplugged during it. Note what you did
between the restart and this check.

### D. The V1.26 firmware upgrade

1. [ ] **Firmware** → follow the steps → choose **V1.26** from the test folder.
2. [ ] Before it starts, note that `BOOK\1.BIN` and `BOOK\BOOKFILE.BIN` exist on the pen.
3. [ ] Run it, and say **Yes** to the Windows prompt.
4. [ ] Immediately after, **before restarting the pen**, check `BOOK\` again.

|  |  |
|---|---|
| Were `1.BIN` and `BOOKFILE.BIN` gone afterwards? | ____ |
| Were all the `.axb` books still there? | ____ |
| Did the app say the update finished? | ____ |
| After a restart, does a book still play? | ____ |

Also worth doing once: start the upgrade and answer **No** to the Windows prompt. The app should
say **the update did not start**, and the pen should be exactly as it was — including both `.BIN`
files back where they were.

### E. The Store build has none of this

Install `PonyABC-Desktop-v0.3.17-winx64.exe` — the Store build — alongside the Internal one.

|  |  |
|---|---|
| Is there a banner across the top? | should be **no** |
| Settings → is there a Testing mode section? | should be **no** |
| Firmware → is there any way to choose a folder by hand? | should be **no** |
| Settings → Version: does it say "· Internal"? | should be **no** |
| Does the BOOK page still work normally? | should be **yes** |

The two install side by side and do not replace each other. If installing one removes the other,
stop and report it: they are supposed to be different products to Windows.

## What to send back

The tables above, and — from whichever build misbehaved — **Settings → Support → Export
diagnostics**.
