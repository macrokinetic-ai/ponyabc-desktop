# Real-pen test — firmware V1.26 with pre-flash cleanup

For 0.3.17. Run on Windows, on a real pen, with a **spare** pen if one exists — step 6 is the
one that can leave a pen in a bad state, and it is also the one worth knowing about.

Everything below can be checked without opening a terminal except where noted.

## Before you start

- A Windows machine with 0.3.17 installed (the MSIX build, not `npm run dev` — the elevated
  launch path differs).
- A pen with **at least one book already on it** and **at least one DIY recording**. An empty
  pen cannot show the thing we most need to see: that neither is harmed.
- Note the firmware version the pen reports today. If it is already V1.26, flash V1.18 first,
  or step 4 proves nothing.

## 1. Record the starting state

With the pen connected, open its drive in File Explorer and write down:

- [ ] `BOOK\` — does `1.BIN` exist? Does `BOOKFILE.BIN`? (Both normally exist on a pen that
      has been used.) Note their sizes.
- [ ] `BOOK\` — the list of `.axb` books and their sizes.
- [ ] `DIY\` — the list of recordings.
- [ ] The pen's current firmware version.

## 2. Run the upgrade to V1.26 from the app

- [ ] Firmware → select the V1.26 package → Next → **Start upgrade** → approve the UAC prompt.
- [ ] It completes with the calm "completed / finished" message, not a red failure.

## 3. Check the cleanup actually happened — THE POINT OF THIS RELEASE

- [ ] Immediately after the upgrade, with the pen still connected and **before rebooting the
      pen**, look in `BOOK\`: `1.BIN` and `BOOKFILE.BIN` should be **gone**.
- [ ] Every `.axb` book from step 1 is still there, same names, same sizes.
- [ ] Every DIY recording from step 1 is still there.

If the two `.BIN` files are still present, the preflight did not run — stop and report it,
because the upgrade below will look fine and not have taken.

## 4. Confirm the firmware actually changed

- [ ] Unplug the pen, power it off and on.
- [ ] Check the version the pen reports. It must now read **V1.26**.

This is the check the whole feature exists for. Before this release the upgrade would report
success here and the version would still read the old one.

## 5. Does the pen rebuild the index? — an open question, please answer it

We do not know whether the pen recreates `1.BIN` and `BOOKFILE.BIN` by itself. Vendor did not
say. It matters: if it does not, and the files are what the pen uses to find its books, then
something must rebuild them or the books stop working.

- [ ] After the reboot in step 4, reconnect the pen and look in `BOOK\` again. Do `1.BIN` and
      `BOOKFILE.BIN` exist now? Note their sizes — the same as step 1, or different?
- [ ] If they are still missing, touch a book with the pen and then re-check. Some devices
      rebuild lazily, on first use rather than on boot.

**Write down what you see either way.** Both answers are useful and neither is a failure.

## 6. Everything still plays

With the pen disconnected from the computer:

- [ ] Touch a page of a book that was on the pen **before** the upgrade — audio plays, and it
      is the right audio for the page.
- [ ] Play a DIY recording made **before** the upgrade — it plays, and it is not truncated.
- [ ] Touch at least two different books, if the pen has two.

If a book that worked before the upgrade is now silent, that is the most important possible
result of this test. Stop and report it with the book's filename.

## 7. A second upgrade in a row

The rule says "before **every** firmware upgrade", so the second one matters as much as the
first.

- [ ] Run the V1.26 upgrade again on the same pen, without changing anything.
- [ ] It completes normally. (If the pen recreated the two files in step 5, check they are
      deleted again; if it did not, the app should report them as absent and carry on —
      absence is not an error.)

## 8. Install a book afterwards

- [ ] Update Book Content → add a book from the official list to the pen.
- [ ] It installs, and — importantly — `1.BIN`/`BOOKFILE.BIN` are **not** deleted by this.
      Book updates must never run the cleanup.
- [ ] Reboot the pen and confirm the newly added book plays.

## 9. What a failure should look like (optional, spare pen only)

To see the guard work, make the deletion fail: with the pen connected, set `BOOK\1.BIN` to
read-only in its file Properties, then start an upgrade.

- [ ] The app stops with "The upgrade did not start — the pen could not be prepared." and
      explains which files must be removed.
- [ ] Nothing was flashed: the pen's version is unchanged, and the books still play.
- [ ] Clear the read-only flag and retry — it now succeeds.

## Reporting

Settings → export diagnostics, and send the file. The upgrade's session log carries a
`preflight` stage recording exactly which files were deleted, so "the upgrade didn't take" can
be answered from the export without guessing.
