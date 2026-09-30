# Reset the pen's book list after any sync that wrote a book

Owner decision, 2026-09-30. Replaces "a same-name replacement leaves the index alone".

**The rule.** If a sync wrote **any** book — added or updated — delete `BOOK/1.BIN` and
`BOOK/BOOKFILE.BIN` once, as the last step, and show "All done! Please unplug your pen…".
If it wrote nothing, touch nothing. If it stopped part-way after writing at least one book,
still reset at the end.

## Work

- [x] 1. `runInstallAction` marks the index stale on **every** completed write; the decision no
      longer reads `updateRequiresIndexReset` (still parsed, still harmless)
- [x] 2. `runSync` finishes the batch when **books were actually written**, not when the plan
      contained updates — that is what makes a part-way sync reset
- [x] 3. Drop the "Your book has been updated, no restart needed" path; one ending for both.
      Remove `done.updatedOnly` from all 8 locales
- [x] 4. Tests: update-only resets · add resets · nothing-to-do does not · partial after one
      written book resets · a failed write before any book completes does not
- [ ] 5. Docs: design note, vendor notes, the real-pen test plan (rebuild time now matters for
      every sync), both manuals, and the design-kit copy
- [ ] 6. typecheck, vitest, build, Windows CI; PM-STATUS; report + INDEX

## Review

The rule is two lines of decision and a lot of wording.

`runInstallAction` marks the index stale on any `completed` write — it no longer asks whether the
write created a file, and no longer reads `updateRequiresIndexReset`. `runSync` ends the batch on
what was **written**, not on what the plan contained, which is the part that makes a sync stopped
by a full card still reset at the end; the old `plan.toUpdate.length > 0` would have reset even
when the first write failed, and would have missed nothing else.

The renderer no longer has a second ending. `done.updatedOnly` is gone from all 8 locales, and
`finishBookBatch` either shows the restart notice or says nothing at all.

Eight tests now pin the rule, six of them new, including the two that would have passed under
either rule and the two that distinguish them: update-only resets, and a first-write failure does
not.

Docs: the owner's rule in `docs/vendor-notes.md` rewritten with what changed and why;
`book-index-reset-catalog.md` marked superseded as a decision and kept for the record;
`library-sync.md`'s same-name paragraph corrected; the real-pen plan's test A now says the
rebuild time matters for every sync and has a new A2 for an update-only one; both manuals'
section 4 rewritten and both PDFs rebuilt.

Not done: the design-kit copy. `/Users/aiagent/Documents/AI-Reports/design-kit/` still does not
exist — searched the whole filesystem, and no kit zip anywhere either.

Gates: typecheck ✅, 696 tests ✅, build ✅, Windows CI — see the report.
