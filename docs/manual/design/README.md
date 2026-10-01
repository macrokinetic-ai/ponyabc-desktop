# The printed manual and the box quick start

Two documents, four PDFs, one command:

```
.venv-manual/bin/python scripts/build-manuals.py
```

| Source | Becomes |
|---|---|
| `user-guide.en.html` | `PonyABC-Desktop-User-Guide-v0.3.17-EN.pdf` (10 pages, A4) |
| — translated at build time → | `…-zh-Hant.pdf` |
| `quick-start.en.html` | `PonyABC-Quick-Start-A4-Fold-v0.3.17-EN.pdf` (1 page, folded into the box) |
| — translated at build time → | `…-zh-Hant.pdf` |

The designs came from the Claude PM as an approved kit; `KIT-README.md` is that kit's own
README and its rules are owner decisions. What this directory adds is the plumbing that makes
the designs build from the repository rather than by hand.

## The English is the source; the Chinese is generated

There is one layout. `strings.zh-Hant.json` maps every visible English string to 書面語, and the
build substitutes whole text nodes. **A new English string with no translation fails the build**,
by name, so the two languages cannot quietly drift apart. `tests/unit/ukEnglish.test.ts` checks
the same thing from the other side, along with British spelling and the rule that a parent never
meets a technical term.

## What the build checks, every time

- **Screenshots** are cropped from the real captures in `docs/manual/screenshots/` — the en-GB
  ones for English, the 繁體中文 ones for Chinese — into frames measured from the kit's own
  images, so the framing stays the designer's.
- **QR codes** are decoded out of the finished PDFs and must each be one of our three
  addresses. A printed code that goes to the wrong place cannot be recalled.
- **Fold panels**: the quick start's eight cards are checked against the real layout — none may
  cross a fold line, and no text may run past the edge of its card, which would be cut off at
  the fold.

## Fonts

Nunito and Baloo 2 come from the kit (SIL OFL). Chinese is set in Noto Sans TC (SIL OFL),
subset by `scripts/subset-cjk-font.py` to the characters these documents use — about 200 KB
rather than 12 MB. If the Chinese copy gains a character the subset lacks, the build says which
character and tells you to rerun that script.

## Building it on a fresh machine

WeasyPrint needs its native libraries, which Apple's bundled Python cannot load:

```
brew install pango
/opt/homebrew/bin/python3 -m venv .venv-manual
.venv-manual/bin/pip install weasyprint pypdfium2 opencv-python-headless pillow fonttools
```

The four PDFs are committed under `docs/manual/pdf/`, so nobody needs this to read them.
