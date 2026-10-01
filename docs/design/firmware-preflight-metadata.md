# Design — serving per-release firmware preflight steps from ponyabc-web

**Status: design only. `ponyabc-web` is frozen until 1 Oct — nothing here is implemented.**

## The problem

Every firmware upgrade must first delete `1.BIN` and `BOOKFILE.BIN` from the pen's `BOOK`
directory (see `docs/vendor-notes.md`). The app now does that by default.

But the rule came from the vendor _after_ V1.18 shipped, and we only found it because
upgrades were silently not taking. If the next firmware needs a _different_ preparation
step, we would have to ship a whole new desktop app release — through Microsoft Store
certification — before anyone could install that firmware. That is days of delay for what
is really one line of vendor instruction.

So the preflight list should travel **with the release**, not with the app. The app already
accepts it as a parameter (`startFirmwareUpgrade({ preflightDeletions })`); what is missing
is the catalogue serving it.

## What ponyabc-web would add

Three columns on `content_items` (firmware rows only), and two fields on the public
firmware response.

### Database

```sql
alter table content_items
  add column preflight_delete    text[],      -- e.g. '{1.BIN,BOOKFILE.BIN}'
  add column preflight_spec_version integer,  -- shape of the preflight contract; starts at 1
  add column min_app_version     text;        -- already exists for firmware; see below
```

`preflight_delete`
: Filenames to remove from the pen's `BOOK` root before flashing. `NULL` means "the app's
built-in default", so existing rows keep working untouched. An explicit `'{}'` means
"this release genuinely needs no preflight" — distinguishable from `NULL`, which matters.

`preflight_spec_version`
: What _kind_ of preflight steps this row describes. Today only `1` exists: "delete these
filenames from the BOOK root". If the vendor later needs something structurally different
— delete a directory, write a marker file, run a sequence — that becomes version `2`, and
an app that only understands `1` **refuses the release** rather than guessing. Without
this field, an old app silently ignores an instruction it cannot perform, which is exactly
the failure mode we are trying to close.

`min_app_version`
: **This is the important one.** `0.3.16` is already live in the Store and knows nothing
about preflight. If a release that _requires_ preflight were served to it, it would flash
without the cleanup and the upgrade would silently not take — the original bug, but now
shipped deliberately. So a release carrying preflight must set
`min_app_version >= 0.3.17`, and the catalogue must not return it to anything older.

### Public API

`GET /api/public/firmware?hardware_rev=…` gains:

```jsonc
{
  "release": {
    "version": "V1.26",
    "minAppVersion": "0.3.17",
    "preflight": {
      "specVersion": 1,
      "deleteFromBookDir": ["1.BIN", "BOOKFILE.BIN"],
    },
  },
}
```

- `preflight` omitted entirely → the app uses its built-in default. Keeps every existing
  client working with no change.
- **Filtering is server-side.** The endpoint must compare the caller's app version against
  `min_app_version` and return `{"release": null}` if it is too old — not return the
  release and trust the client to refuse. The client should _also_ refuse, but a client
  that already shipped cannot be relied on. That means the app sends its version, most
  simply as `?app_version=0.3.17`, defaulting to "oldest" when absent.

### Admin

The Content screen's firmware form gains a preflight-filenames field (one per line), and
`min_app_version`. Both need validating: filenames only — no path separators, no `..`, no
absolute paths — because whatever lands here is turned into a delete on a customer's pen.
That validation belongs on the server, not just the form.

## What the desktop app still enforces, regardless

The server is not trusted to be careful. The app keeps every guard it has now:

- the target must be a real pen (`BOOK` **and** `DIY` present);
- only the `BOOK` root, never recursive;
- **filenames only** — anything containing `/`, `\`, or `..` is rejected outright, so a
  compromised or mis-edited catalogue row cannot reach outside `BOOK`;
- a failed deletion aborts before flashing;
- every deletion logged.

A server-supplied list should also be **capped** (say 8 entries) so a bad row cannot turn
into an unbounded delete loop. _(Not yet implemented — the app currently accepts any list
it is given, which is fine while the only caller passes the built-in constant, and must be
added before the catalogue can supply one.)_

## Rollout order

1. Ship desktop `0.3.17` with the built-in default preflight. **Wait for it to be live in
   the Store.**
2. Add the columns and the API fields (additive, `NULL` default — safe with `0.3.16`).
3. Only then publish a firmware row carrying `preflight` + `min_app_version: 0.3.17`.

Doing 3 before 1 would serve preflight-requiring firmware to an app that cannot perform it.
This is the same schema-and-code-must-ship-together rule that caused three separate
production failures in `ponyabc-web` — worth not repeating here.

## Effort

|                                                                                |          |
| ------------------------------------------------------------------------------ | -------- |
| Migration + admin form + validation                                            | ~0.5 day |
| API field + server-side `min_app_version` filtering                            | ~0.5 day |
| Desktop: consume `preflight` from the catalogue, filename-only validation, cap | ~0.5 day |
| Tests both sides                                                               | ~0.5 day |

~2 days total, and none of it is on the critical path for the expo.
