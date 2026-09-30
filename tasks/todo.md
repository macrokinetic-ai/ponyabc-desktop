# Reset the pen's book list after any sync that wrote a book

Owner decision, 2026-09-30. Replaces "a same-name replacement leaves the index alone".

**The rule.** If a sync wrote **any** book — added or updated — delete `BOOK/1.BIN` and
`BOOK/BOOKFILE.BIN` once, as the last step, and show "All done! Please unplug your pen…".
If it wrote nothing, touch nothing. If it stopped part-way after writing at least one book,
still reset at the end.

## Work

- [ ] 1. `runInstallAction` marks the index stale on **every** completed write; the decision no
      longer reads `updateRequiresIndexReset` (still parsed, still harmless)
- [ ] 2. `runSync` finishes the batch when **books were actually written**, not when the plan
      contained updates — that is what makes a part-way sync reset
- [ ] 3. Drop the "Your book has been updated, no restart needed" path; one ending for both.
      Remove `done.updatedOnly` from all 8 locales
- [ ] 4. Tests: update-only resets · add resets · nothing-to-do does not · partial after one
      written book resets · a failed write before any book completes does not
- [ ] 5. Docs: design note, vendor notes, the real-pen test plan (rebuild time now matters for
      every sync), both manuals, and the design-kit copy
- [ ] 6. typecheck, vitest, build, Windows CI; PM-STATUS; report + INDEX
