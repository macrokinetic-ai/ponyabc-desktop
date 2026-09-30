#!/usr/bin/env python3
"""
The printed manual and the box quick start — both languages, from the repo.

One command produces all four PDFs:

    .venv-manual/bin/python scripts/build-manuals.py

What it does, in order:

1. Crops the real en-GB screenshots (docs/manual/screenshots, captured from the app on
   Windows) into the frames the design expects. The crop table is the design's, measured
   from the kit's interim images, so the framing is the designer's rather than mine.
2. Builds the 繁體中文 HTML from the English HTML by substituting whole text nodes from
   strings.zh-Hant.json, and FAILS if any visible English string has no translation. There is
   one layout, so the two languages cannot drift apart.
3. Renders each HTML to PDF with WeasyPrint, the renderer the design was made for.
4. Decodes every QR code in every rendered page and fails unless each one is a URL we
   expect. A printed code that goes to the wrong place cannot be recalled.

Fonts: Nunito and Baloo 2 (SIL OFL) come from the kit. Chinese is set in Noto Sans TC
(SIL OFL), subset to the characters these documents actually use — regenerate with
scripts/subset-cjk-font.py if the Chinese copy gains a new character; the build says so.
"""

import html
import json
import re
import sys
from pathlib import Path

from PIL import Image
import weasyprint
import pypdfium2
import cv2
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
DESIGN = ROOT / 'docs/manual/design'
CAPTURES = ROOT / 'docs/manual/screenshots'
OUT = ROOT / 'docs/manual/pdf'
SHOTS = DESIGN / 'screenshots'

# role -> (capture, left, top, width, height). Measured from the design kit's own images, so
# the framing stays the designer's; the pixels are the real app's.
CROPS = {
    's-000': ('01-home', 0, 0, 2560, 1150),
    's-002': ('03-books-summary', 0, 0, 2560, 718),
    's-003': ('04-books-up-to-date', 0, 0, 2560, 718),
    's-004': ('07-books-sync-finished', 0, 0, 2560, 906),
    's-005': ('05-books-not-enough-space', 0, 0, 2560, 990),
    's-007': ('15-firmware-prepare', 0, 0, 2560, 736),
    's-010': ('18-firmware-finished', 0, 0, 2560, 650),
    's-013': ('11-recordings-backed-up', 0, 0, 2560, 1490),
    's-014': ('12-recordings-restore', 0, 0, 2560, 2204),
    's-015': ('14-recordings-label', 0, 0, 2560, 1428),
    's-016': ('13-recordings-sticker', 0, 0, 2560, 1428),
    's-018': ('08-books-fix-list', 0, 0, 2560, 984),
    'p-book': ('03-books-summary', 0, 0, 1900, 560),
    'p-done': ('07-books-sync-finished', 505, 545, 1585, 190),
    'p-rec': ('11-recordings-backed-up', 440, 190, 1035, 1140),
}

# Every QR in the documents, and the only URL each may contain.
QR_EXPECTED = {
    'https://ponyabc.co.uk',
    'https://register.ponyabc.uk',
    'https://apps.microsoft.com/detail/9P544XC6B609',
}

DOCS = [
    ('user-guide', 'PonyABC-Desktop-User-Guide'),
    ('quick-start', 'PonyABC-Quick-Start-A4-Fold'),
]
LANGS = ['en', 'zh-Hant']

CJK_STYLE = """
@page{@bottom-left{content:"PonyABC Desktop 使用說明書 · 程式版本 0.3.17 · 2026 年 9 月"}
      @bottom-right{content:"第 " counter(page) " 頁"}}
@font-face{font-family:NotoTC;src:url(assets/NotoSansTC-Regular.ttf);font-weight:400}
@font-face{font-family:NotoTC;src:url(assets/NotoSansTC-Bold.ttf);font-weight:700}
body{font-family:NotoTC,sans-serif}
h1,h2,h3,.big,.ht,.qa b.q,.tip b.t,.num,.badge,.contents span,.hu,.cap,.btn,.btnr{font-family:NotoTC;font-weight:700}
"""


def fail(message: str) -> None:
    print(f'FAILED: {message}', file=sys.stderr)
    sys.exit(1)


# ---------------------------------------------------------------- screenshots ----

def crop_screenshots() -> None:
    for lang in LANGS:
        target = SHOTS / lang
        target.mkdir(parents=True, exist_ok=True)
        for role, (capture, x, y, w, h) in CROPS.items():
            source = CAPTURES / f'{capture}-{lang}.png'
            if not source.exists():
                fail(f'no capture for {role}: {source} is missing — run the screenshot capture first')
            image = Image.open(source)
            if image.width < x + w:
                fail(f'{source.name} is {image.width}px wide, too narrow for the {role} frame '
                     f'({w}px at x={x}) — the screen changed shape, so the crop needs remeasuring')
            # The captures are already trimmed to their content, and Chinese wraps shorter than
            # English, so a frame may reach past the bottom of its capture. Stopping at the
            # bottom keeps the framing and never invents blank space; falling short of the
            # content would hide something, so that still fails.
            bottom = min(y + h, image.height)
            if bottom - y < h * 0.6:
                fail(f'{source.name} is only {image.height}px tall against the {role} frame '
                     f'({h}px from y={y}) — too short to be the same screen; remeasure the crop')
            image.crop((x, y, x + w, bottom)).save(target / f'{role}.png')
    print(f'  screenshots: {len(CROPS)} frames x {len(LANGS)} languages')


# ------------------------------------------------------------------ language ----

TEXT_NODE = re.compile(r'>([^<>]+)<')
IGNORABLE = re.compile(r'^[\s\d.,:·—→&;%/()\[\] -]*$')


def visible_strings(markup: str) -> list[str]:
    body = re.sub(r'<style>.*?</style>', '', markup, flags=re.S)
    body = re.sub(r'<!--.*?-->', '', body, flags=re.S)
    out = []
    for raw in re.split(r'<[^>]+>', body):
        text = html.unescape(raw).strip()
        if text and not IGNORABLE.match(text):
            out.append(text)
    return out


def translate(markup: str, strings: dict[str, str]) -> str:
    """Substitute whole text nodes. Longest first, so no phrase is eaten by a shorter one."""
    missing = [s for s in visible_strings(markup) if s not in strings]
    if missing:
        fail('no 繁體中文 for these strings — add them to strings.zh-Hant.json:\n    '
             + '\n    '.join(repr(m) for m in dict.fromkeys(missing)))

    def replace_node(match: re.Match) -> str:
        text = match.group(1)
        stripped = text.strip()
        if not stripped:
            return match.group(0)
        # Punctuation-only nodes are looked up too: a full stop after Chinese text has to
        # become a full-width one, or the sentence ends in the wrong alphabet.
        translated = strings.get(html.unescape(stripped))
        if translated is None:
            return match.group(0)
        return '>' + text.replace(stripped, html.escape(translated, quote=False)) + '<'

    head, _, rest = markup.partition('</style>')
    translated_body = TEXT_NODE.sub(replace_node, rest)
    return head + CJK_STYLE + '</style>' + translated_body


def check_font_coverage(markup: str) -> None:
    from fontTools.ttLib import TTFont
    for weight in ('Regular', 'Bold'):
        path = DESIGN / f'assets/NotoSansTC-{weight}.ttf'
        covered = set()
        for table in TTFont(path)['cmap'].tables:
            covered.update(table.cmap)
        used = {ord(c) for s in visible_strings(markup) for c in s if ord(c) > 0x2000}
        gaps = sorted(used - covered)
        if gaps:
            fail(f'NotoSansTC-{weight}.ttf has no glyph for {"".join(chr(g) for g in gaps)} — '
                 f'rerun scripts/subset-cjk-font.py')


# -------------------------------------------------------------------- render ----

def render(source_html: Path, pdf: Path):
    document = weasyprint.HTML(string=source_html.read_text(encoding='utf-8'),
                               base_url=str(DESIGN) + '/').render()
    document.write_pdf(pdf)
    return document


# ------------------------------------------------------------------- folding ----

MM = 96 / 25.4           # CSS px per mm
FOLD_X = [105 * MM]                                  # the one vertical fold
FOLD_Y = [74.25 * MM, 148.5 * MM, 222.75 * MM]       # the three horizontal folds


def _walk(box, depth=0):
    yield depth, box
    for child in getattr(box, 'children', []):
        yield from _walk(child, depth + 1)


def check_fold_panels(document, name: str) -> int:
    """The quick start is folded into the box, so a card that crosses a fold is folded in half,
    and a card whose text runs past its own edge is a sentence the parent never sees. Both are
    checked against the real layout rather than by eye."""
    page = document.pages[0]
    cards = [box for _, box in _walk(page._page_box)
             if getattr(box, 'element', None) is not None and 'card' in (box.element.get('class') or '')]
    if len(cards) != 8:
        fail(f'{name}: found {len(cards)} panels, expected the 2 x 4 fold grid of 8')

    for card in cards:
        # The border box, not the content box: a child legitimately sits inside the padding.
        left, top = card.border_box_x(), card.border_box_y()
        right, bottom = left + card.border_width(), top + card.border_height()
        for fold in FOLD_X:
            if left < fold < right:
                fail(f'{name}: a panel crosses the vertical fold at 105 mm')
        for fold in FOLD_Y:
            if top < fold < bottom:
                fail(f'{name}: a panel crosses a horizontal fold at {fold / MM:.2f} mm')

        # Text only: the decorative animals and paw prints are positioned to bleed on purpose.
        for _, box in _walk(card):
            if box is card or getattr(box, 'element_tag', None) in (None, 'img'):
                continue
            try:
                box_bottom = box.border_box_y() + box.border_height()
                box_right = box.border_box_x() + box.border_width()
            except AttributeError:
                continue
            # 0.75 px of tolerance, for rounding in the layout itself.
            if box_bottom > bottom + 0.75 or box_right > right + 0.75:
                tag = getattr(box, 'element_tag', '?')
                fail(f'{name}: a <{tag}> runs past the edge of its panel by '
                     f'{max(box_bottom - bottom, box_right - right):.1f}px — the text would be cut '
                     f'off at the fold. Shorten the copy or let the panel breathe.')
    return len(cards)


# ----------------------------------------------------------------------- QRs ----

def check_qr_codes(pdf: Path) -> int:
    """Decode every QR on every page of the finished PDF. A printed code cannot be recalled."""
    detector = cv2.QRCodeDetector()
    found = 0
    document = pypdfium2.PdfDocument(pdf)
    for page in document:
        image = page.render(scale=3).to_pil().convert('RGB')
        frame = cv2.cvtColor(np.array(image), cv2.COLOR_RGB2BGR)
        ok, decoded, points, _ = detector.detectAndDecodeMulti(frame)
        if not ok:
            continue
        for url in decoded:
            if not url:
                fail(f'{pdf.name}: a QR code was found but could not be decoded')
            if url.rstrip('/') not in {u.rstrip('/') for u in QR_EXPECTED}:
                fail(f'{pdf.name}: a QR code points at {url!r}, which is not one of our addresses')
            found += 1
    return found


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    strings = json.loads((DESIGN / 'strings.zh-Hant.json').read_text(encoding='utf-8'))

    print('Building the manual and quick start')
    crop_screenshots()

    total_qr = 0
    for stem, out_name in DOCS:
        english = (DESIGN / f'{stem}.en.html').read_text(encoding='utf-8')
        chinese = translate(english, strings)
        check_font_coverage(chinese)
        (DESIGN / f'{stem}.zh-Hant.html').write_text(chinese, encoding='utf-8')

        for lang in LANGS:
            # The design's markup says `screenshots/s-000.png` and stays exactly as the
            # designer wrote it; this puts the right language's frames at that path before
            # each render, so one set of markup serves both languages.
            for frame in (SHOTS / lang).glob('*.png'):
                (SHOTS / frame.name).write_bytes(frame.read_bytes())
            pdf = OUT / f'{out_name}-v0.3.17-{lang.upper() if lang == "en" else lang}.pdf'
            document = render(DESIGN / f'{stem}.{lang}.html', pdf)
            folds = f', {check_fold_panels(document, pdf.name)} panels inside their folds' if stem == 'quick-start' else ''
            qr = check_qr_codes(pdf)
            total_qr += qr
            pages = len(pypdfium2.PdfDocument(pdf))
            print(f'  {pdf.name}  {pages} page(s), {qr} QR code(s) checked{folds}, {pdf.stat().st_size // 1024} KB')

    print(f'All four PDFs built. {total_qr} QR codes decoded, every one of ours.')


if __name__ == '__main__':
    main()
