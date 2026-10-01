# PonyABC print & manual design kit (from Claude PM, 2026-09-30)

Two approved designs, as HTML + CSS, rendered to PDF with WeasyPrint (`pip install weasyprint`):

- `user-guide.html` → the website user guide (A4, 10 pages)
- `quick-start-fold.html` → the one-page A4 quick start that is FOLDED INTO THE PRODUCT BOX

Render: `python -c "import weasyprint;weasyprint.HTML('user-guide.html',base_url='.').write_pdf('out.pdf')"`

## Rules (owner decisions - keep them)
- UK English only. Dates like 29 September 2026 / 29/09/2026, 24-hour time.
- Customers are nursery parents: no technical words (no BIN files, checksums, catalogue internals).
- Always show: PonyABC logo, app version + date, "this printed guide may not show the newest version -
  see ponyabc.co.uk", and QR codes + URLs for https://ponyabc.co.uk, https://register.ponyabc.uk and
  https://apps.microsoft.com/detail/9P544XC6B609. Re-verify every QR decodes after any change.
- Quick start fold layout: A4 split into 2 columns x 4 rows (105 x 74.25 mm panels). Each panel is its
  own rounded card; fold lines fall in the white gaps; only faint ticks at the paper edge. Nothing may
  cross a fold line. Top-left panel is the cover.
- Cute PonyABC style: brand colours (red #e8452c, purple #7b4b9a, green #00a56e, blue #1ba9dc,
  orange #f5a623), fonts Baloo 2 ExtraBold (headings) + Nunito (text), the small animal SVGs and paw prints.

## Screenshots
`screenshots/` holds interim images (US dates were patched by hand). Replace them with the real
en-GB captures from the app, cropping empty space; keep file roles:
s-000 home connected, s-002 BOOK summary, s-003 up to date, s-004 all done, s-005 not enough space,
s-007 firmware prepare, s-010 firmware done, s-013 recordings backed up, s-014 restore choose,
s-015 rename, s-016 change sticker number, s-018 fix my pen's book list;
p-book / p-done / p-rec are the tighter crops used in the quick start.

## Fonts
Nunito and Baloo 2 are SIL Open Font License (Google Fonts); static instances are in `assets/`.
