#!/usr/bin/env python3
"""
Cuts Noto Sans TC down to the characters the Chinese manual and quick start actually use.

The full font is 12 MB of variable font, and a repository is a poor place for 12 MB that only
a few hundred characters of it are needed from. This makes two static instances — Regular and
Bold — carrying exactly the characters in strings.zh-Hant.json plus Latin, digits and
punctuation, which comes to a few tens of kilobytes.

    .venv-manual/bin/python scripts/subset-cjk-font.py

Run it whenever the Chinese copy gains a character the font does not have; the manual build
fails with that exact character listed, so you will know.

Source: Noto Sans TC, SIL Open Font License 1.1, from github.com/google/fonts (ofl/notosanstc).
The same licence as the kit's Nunito and Baloo 2.
"""

import json
import subprocess
import sys
import tempfile
from pathlib import Path

from fontTools import ttLib
from fontTools.subset import Subsetter, Options
from fontTools.varLib import instancer

ROOT = Path(__file__).resolve().parent.parent
DESIGN = ROOT / 'docs/manual/design'
SOURCE_URL = 'https://github.com/google/fonts/raw/main/ofl/notosanstc/NotoSansTC%5Bwght%5D.ttf'

# Everything the design might set in the Chinese documents, beyond the copy itself.
ALWAYS = (
    'abcdefghijklmnopqrstuvwxyz'
    'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
    '0123456789'
    ' .,:;!?\'"()[]{}<>/\\|-–—_@#&*+=%·…‘’“”「」『』、。，；：！？（）《》〈〉→⋯ '
)


def main() -> None:
    strings = json.loads((DESIGN / 'strings.zh-Hant.json').read_text(encoding='utf-8'))
    wanted = set(ALWAYS)
    for value in strings.values():
        wanted.update(value)

    source = Path(sys.argv[1]) if len(sys.argv) > 1 else None
    if source is None:
        source = Path(tempfile.gettempdir()) / 'NotoSansTC-variable.ttf'
        if not source.exists():
            print(f'downloading {SOURCE_URL}')
            subprocess.run(['curl', '-sL', '-o', str(source), SOURCE_URL], check=True)

    for weight, name in ((400, 'Regular'), (700, 'Bold')):
        font = instancer.instantiateVariableFont(ttLib.TTFont(source), {'wght': weight})
        options = Options()
        options.layout_features = ['*']
        options.name_IDs = ['*']
        options.notdef_outline = True
        subsetter = Subsetter(options=options)
        subsetter.populate(text=''.join(sorted(wanted)))
        subsetter.subset(font)
        out = DESIGN / f'assets/NotoSansTC-{name}.ttf'
        font.save(out)
        print(f'  {out.relative_to(ROOT)}  {out.stat().st_size // 1024} KB, {len(wanted)} characters')


if __name__ == '__main__':
    main()
