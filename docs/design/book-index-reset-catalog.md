# Design — a catalog flag for "this update also needs the book list rebuilt"

**Status: app side implemented and live, defaulting to `false`. The server side is design only —
`ponyabc-web` sends nothing, and the app is correct without it.**

## Why a flag at all

The pen builds `BOOK/BOOKFILE.BIN` itself, one 44-byte record per `.axb`, and identifies a book
by its **position** in that array. So:

| What the customer did          | Does the list go stale?                                                     |
| ------------------------------ | --------------------------------------------------------------------------- |
| Added a book                   | **Yes** — it sits past the end of the index and is silent                   |
| Removed a book                 | **Yes** — every later book shifts down, and the pen reads the _wrong_ story |
| Replaced a book, same filename | **No** — same position, same order. Verified on a real pen.                 |

The app applies exactly that rule today and needs no help from the server to do it.

The gap is a **future edition of an existing book** that keeps its filename but changes its OID
code range — or its record type. (We have seen a type byte differ already: the 37 books on the
current card carry `0x02` in record byte 3, and `phonics card.axb` carries `0x03`.) Such an
update would keep its position, so the app would correctly decide "no rebuild needed", and the
index would still be describing the previous edition's codes. The book would play the wrong
audio, and nothing would look wrong.

We cannot detect that from the file: the OID range lives inside the `.axb`, and the app has
never parsed `.axb` internals. The publisher knows, though, because they made the edition.

## The field

```sql
alter table content_versions
  add column update_requires_index_reset boolean not null default false;
```

On the version row, not the book row: it is a property of _this edition_, and the next one may
not need it.

Exposed on `GET /api/public/books` as a sibling of the existing fields:

```jsonc
{
  "id": "…",
  "originalFileName": "phonics card.axb",
  "sha256": "…",
  "updateRequiresIndexReset": true,
}
```

## What the app already does with it

`src/main/services/bookCatalog/httpClient.ts` reads it as `updateRequiresIndexReset`, and
`src/main/ipc/book.ts` treats a completed write as index-invalidating when **either** the write
created a new file **or** this flag is set:

```ts
if (
  result.status === "completed" &&
  (result.createdNewFile === true || entry.updateRequiresIndexReset)
) {
  markBookIndexStale("added");
}
```

Two deliberate choices:

- **`b.updateRequiresIndexReset === true`, strictly.** A missing field, a string `"true"`, a `1`
  — all mean false. The cost of a wrong `true` is one unnecessary restart; the cost of a wrong
  `false` is a pen reading the wrong story to a child. The asymmetry decides the parsing.
- **Default false.** Every existing row keeps working untouched, and publishing the column later
  needs no app release. 0.3.16 and 0.3.17 both ignore a field they do not know about.

## Admin

The content form needs one checkbox on the version, labelled for the person publishing rather
than for the pen: _"This edition changes which page numbers it uses — pens will need to rebuild
their book list."_ Off by default, and worth a sentence of help text, because someone will have
to decide it correctly a year from now.

## Rollout

The column is additive with a safe default, so the order barely matters — but for the record:
add the column and the API field whenever convenient, and only then set it `true` on a row. An
app that has never heard of it behaves exactly as it does today.

## Effort

Migration + API field + admin checkbox + tests: about half a day. The app side is done.
