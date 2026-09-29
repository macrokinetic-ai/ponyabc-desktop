# Update Book Content — what every label means

Two audiences in one file: the **exact condition** each status comes from (for us) and the
**wording the customer sees** (for support, and for whoever writes the manual). They are kept
together on purpose — the last time they lived apart, the UI said "On pen" for two conditions
that mean quite different things.

The strings live in `src/renderer/i18n/locales/<locale>/book.json`; the mapping from status to
string lives in `src/renderer/screens/bookStatusLabels.ts`, which also drives the in-app legend,
so nothing here can be shown without being explained.

## The one thing to understand first

The screen reports **two independent facts** about an official book:

1. **Is it on the pen?** — the status.
2. **Is a copy stored on this computer?** — the cache line ("Cached" / "Not downloaded").

Neither implies the other. A book can be cached but not on the pen, or on the pen but not
cached. Reading "Cached" as "it's on the pen" is the most common misreading of this screen, and
it is why the in-app legend states it in its first sentence.

The second thing: **"On pen" never means "checked".** Listing and refreshing only `stat` the
files — the App never reads a book's bytes unless you press Verify. So "On pen" means the
filename matched, nothing more.

## Content on the pen (left pane)

Source: `BookPenMatchStatus`, computed in `src/main/services/bookReconcile.ts`.

| Status                 | Chip           | Exact condition                                                                                                                                                                                                |
| ---------------------- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `verified-current`     | Verified       | A verification you ran found the file's SHA-256 equal to the catalog's, **and** that record is still valid for this pen volume, this generation, and this file's size + mtime.                                 |
| `present`              | On pen         | The filename matches exactly one unambiguous catalog entry, the size matches, but no valid verification record exists. **The resting state after any refresh** — not a problem.                                |
| `matched-hash-unknown` | No checksum    | Filename matches, but the catalog entry is not install-eligible (`filenameSource !== 'declared'` or `sha256 === null`), so there is no official hash to compare with. Nothing can make this become "Verified". |
| `verified-differs`     | Differs        | A still-valid verification found the file's SHA-256 **different** from the catalog's.                                                                                                                          |
| `size-differs`         | Size differs   | The file's size differs from the catalog's declared size. Decided from `stat` alone, and it short-circuits the hash check entirely — a size mismatch is already conclusive.                                    |
| `verifying`            | Verifying…     | A verification is reading this file right now.                                                                                                                                                                 |
| `awaiting-catalog`     | No catalog     | The filename matched nothing **and no catalog has ever been fetched** (`snapshot === null`). There is nothing to judge it against yet — it must never be presented as "checked and unrecognized".              |
| `unknown`              | Not in catalog | The filename matched nothing **and** a real catalog snapshot exists (even an empty one). Not removable — structurally, an unmatched file never gets `removable: true`.                                         |

`awaiting-catalog` and `unknown` look the same to a customer and are not: the first is "we
haven't looked yet", the second is "we looked and this isn't ours". Only the second is a
statement about the file.

## Official content (right pane)

Source: `BookCatalogItemStatus`, same function. These describe a catalog item's presence on the
connected pen, so they are the same distinctions seen from the other side.

| Status                | Chip         | Exact condition                                                                                                                                                                                                   |
| --------------------- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `not-on-pen`          | Not on pen   | No pen file matches this entry's filename. (Also what you see with no pen connected.)                                                                                                                             |
| `on-pen-current`      | Verified     | Mirror of `verified-current`.                                                                                                                                                                                     |
| `on-pen-present`      | On pen       | Mirror of `present` — matched by name, size equal, contents unchecked.                                                                                                                                            |
| `on-pen-differs`      | Differs      | Mirror of `verified-differs`.                                                                                                                                                                                     |
| `on-pen-size-differs` | Size differs | Mirror of `size-differs`.                                                                                                                                                                                         |
| `on-pen-verifying`    | Verifying…   | A verification is running against the pen's copy.                                                                                                                                                                 |
| `metadata-incomplete` | Incomplete   | `isInstallEligible()` is false: the catalog entry lacks a declared filename or a hash. **A server-side data problem, not a pen problem** — worth saying plainly, because it reads like a fault. Never actionable. |
| `ambiguous`           | Ambiguous    | Two or more catalog entries claim the same filename, so no match is safe. Reference only until fixed on the server. Never actionable, and never a match target for anything.                                      |

`actionable` (what enables Add / Replace) is true only for `not-on-pen`, `on-pen-present`,
`on-pen-differs` and `on-pen-size-differs`, and only when the entry is install-eligible and
unambiguous. Never while verifying (don't race a write against a read) and never for
`on-pen-current` (nothing to do). `bookInstall.ts` enforces the same rule independently — the
UI flag is a hint, never the gate.

## Copies on this computer

| Label          | Exact condition                                                                        |
| -------------- | -------------------------------------------------------------------------------------- |
| Cached         | A verified-good copy is in the App's own download cache. Installing needs no download. |
| Not downloaded | No cached copy. It will be downloaded when you add it to the pen.                      |
| Downloading…   | A download is in flight for this item.                                                 |

## Where each string is shown

- **Chip** (`statusShort.*`) — the collapsed row. A couple of words; no explanation.
- **Full** (`status.*`) — the expanded row detail.
- **Help** (`statusHelp.*`) — the condition, in plain language, plus what to do. Shown in the
  expanded detail, as the chip's `title` tooltip, and in the legend.

The legend is a `<details>` under both panes, always available rather than appearing only when
something unusual happens, and its body renders only while open so it does not duplicate every
label in the accessibility tree. A tooltip alone would not do: `title` is unreachable by
keyboard and on a touch screen, and these labels are precisely the ones a confused user needs
to read slowly.

`tests/unit/bookStatusLabels.test.ts` fails if a status exists without all three strings, if a
locale is missing one, if a help string is a copy of its own label, or if a status is missing
from the legend. Adding a status to the union without explaining it does not compile past CI.

## Wording changes in 0.3.17

| Status                 | Was                                                 | Now                                                                   | Why                                                                                                                                                                       |
| ---------------------- | --------------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `matched-hash-unknown` | "Cannot verify against the catalog" / chip "On pen" | "On pen — no official checksum to check against" / chip "No checksum" | The chip was identical to `present`'s, hiding a real difference: one is _not yet_ verified, the other can _never_ be. The full wording also read like a fault in the App. |
| `awaiting-catalog`     | "Waiting for catalog match"                         | "On pen — catalog not loaded yet"                                     | It sounded like the file was in a queue. It is on the pen; the missing piece is the catalog.                                                                              |
| `unknown`              | "Unknown"                                           | "Not official content" / chip "Not in catalog"                        | "Unknown" implied something was wrong with the file. It is simply not ours, and the App leaves it alone.                                                                  |
