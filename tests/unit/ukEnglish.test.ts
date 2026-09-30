import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { formatDate, formatDateTime, formatDateTimeMedium, formattingLocale } from '../../src/shared/dateFormat';

/**
 * The English the customer reads is British English, and the dates they read are British dates.
 *
 * Both halves were real faults, not hypotheticals: the BOOK page showed "9/29/2026, 10:17:07 PM"
 * because half the screens formatted with no locale at all, and the app's own strings said
 * "catalog", "Unrecognized" and "authorization".
 */

const REPO = path.resolve(__dirname, '..', '..');
const EN_BUNDLE = path.join(REPO, 'src/renderer/i18n/locales/en');

/** Proper nouns that are spelled the American way because that is their name. */
const ALLOWED_PHRASES = ['MIT License', 'Partner Center', 'Microsoft Store'];

/** American spelling on the left, what we write instead on the right. */
const AMERICAN: Array<[RegExp, string]> = [
  [/\bcolors?\b|\bcolored\b/i, 'colour'],
  [/\bbehaviors?\b/i, 'behaviour'],
  [/\bfavorites?\b/i, 'favourite'],
  [/\bhonor(s|ed)?\b/i, 'honour'],
  [/\bcenters?\b|\bcentered\b/i, 'centre'],
  [/\bmeters?\b/i, 'metre'],
  [/\btheaters?\b/i, 'theatre'],
  [/\bdefense\b|\boffense\b|\bpretense\b/i, '-ce ending'],
  [/\b\w*(?<!s)(analyz|organiz|recogniz|customiz|apologiz|synchroniz|authoriz|prioritiz|summariz|categoriz|finaliz|realiz|memoriz|utiliz|specializ|normaliz|minimiz|maximiz|optimiz|initializ)\w*\b/i, '-ise/-yse'],
  [/\bcancel(ed|ing)\b|\blabel(ed|ing)\b|\btravel(ed|ing)\b|\bmodeling\b/i, 'double the l'],
  [/\bfulfill\b|\benrollment\b|\bskillful\b|\binstallment\b/i, 'single l'],
  [/\bcatalogs?\b/i, 'catalogue'],
  [/\bdialogs?\b/i, 'dialogue'],
  [/\bgray\b/i, 'grey'],
  [/\bmoms?\b/i, 'mum'],
  [/\bmath\b/i, 'maths'],
  [/\bgotten\b/i, 'got'],
  [/\bairplane\b|\baluminum\b|\bjewelry\b|\bflashlight\b/i, 'the British word'],
  [/\bcheck out\b/i, 'have a look at'],
];

function stringsIn(file: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  const walk = (value: unknown, keyPath: string): void => {
    if (typeof value === 'string') out.push([keyPath, value]);
    else if (value && typeof value === 'object') {
      for (const [k, v] of Object.entries(value)) walk(v, keyPath ? `${keyPath}.${k}` : k);
    }
  };
  walk(JSON.parse(fs.readFileSync(file, 'utf8')), '');
  return out;
}

const withoutAllowedPhrases = (text: string): string =>
  ALLOWED_PHRASES.reduce((acc, phrase) => acc.split(phrase).join(''), text);

describe('the English a customer reads is British English', () => {
  const bundles = fs.readdirSync(EN_BUNDLE).filter((f) => f.endsWith('.json'));

  it('has bundles to check at all', () => {
    expect(bundles.length).toBeGreaterThan(0);
  });

  for (const bundle of bundles) {
    it(`${bundle} uses no American spellings`, () => {
      const offences: string[] = [];
      for (const [keyPath, value] of stringsIn(path.join(EN_BUNDLE, bundle))) {
        const text = withoutAllowedPhrases(value);
        for (const [pattern, better] of AMERICAN) {
          const hit = pattern.exec(text);
          if (hit) offences.push(`${bundle}:${keyPath} — "${hit[0]}" (use ${better}): ${value.slice(0, 80)}`);
        }
      }
      expect(offences).toEqual([]);
    });
  }

  // The printed manual and the quick start are the English source for both documents — the
  // 繁體中文 versions are generated from them — so American spelling here reaches print.
  const PRINTED = [
    'docs/manual/design/user-guide.en.html',
    'docs/manual/design/quick-start.en.html',
    'store-assets/whats-new-0.3.17.md',
    'store-assets/store-listing-0.3.17.md',
  ];

  for (const doc of PRINTED) {
    it(`${doc} uses no American spellings`, () => {
      const raw = fs.readFileSync(path.join(REPO, doc), 'utf8');
      // Strip CSS and markup: `color`, `center` and `text-align` are properties, not prose.
      const prose = raw
        .replace(/<style>[\s\S]*?<\/style>/g, ' ')
        .replace(/<!--[\s\S]*?-->/g, ' ')
        .replace(/<[^>]+>/g, ' ');
      const text = withoutAllowedPhrases(prose);
      const offences = AMERICAN.flatMap(([pattern, better]) => {
        const hit = pattern.exec(text);
        return hit ? [`${doc} — "${hit[0]}" (use ${better})`] : [];
      });
      expect(offences).toEqual([]);
    });
  }

  it('the printed documents say the version and date, and point at the website', () => {
    // Owner's rule in the design kit: every printed page carries the app version, and says
    // that a printed guide may not show the newest one.
    for (const doc of PRINTED.slice(0, 2)) {
      const text = fs.readFileSync(path.join(REPO, doc), 'utf8');
      expect(text).toContain('0.3.17');
      expect(text).toContain('ponyabc.co.uk');
    }
  });

  it('the printed documents never show a technical term to a parent', () => {
    const FORBIDDEN = /\b(1\.BIN|BOOKFILE|checksum|SHA-?256|manifest|preflight|catalogue entry|OID)\b/i;
    for (const doc of PRINTED.slice(0, 2)) {
      const text = fs.readFileSync(path.join(REPO, doc), 'utf8');
      const hit = FORBIDDEN.exec(text);
      expect(hit ? `${doc}: ${hit[0]}` : null).toBeNull();
    }
  });

  it('every visible English string in the printed documents has a 繁體中文 translation', () => {
    const strings = JSON.parse(fs.readFileSync(path.join(REPO, 'docs/manual/design/strings.zh-Hant.json'), 'utf8'));
    const ignorable = /^[\s\d.,:;·—→&%/()[\]\u00a0-]*$/;
    for (const doc of PRINTED.slice(0, 2)) {
      const raw = fs.readFileSync(path.join(REPO, doc), 'utf8')
        .replace(/<style>[\s\S]*?<\/style>/g, ' ')
        .replace(/<!--[\s\S]*?-->/g, ' ');
      const missing = raw
        .split(/<[^>]+>/)
        .map((t) => t.replace(/&amp;/g, '&').replace(/&nbsp;/g, '\u00a0').trim())
        .filter((t) => t && !ignorable.test(t))
        .filter((t) => !(t in strings));
      expect(missing).toEqual([]);
    }
  });
});

describe('dates and times', () => {
  // Built from local parts on purpose: the formatter uses the machine's time zone, so this is
  // the same wall-clock reading wherever the test runs.
  const evening = new Date(2026, 8, 29, 22, 17, 7).getTime();
  const afternoon = new Date(2026, 0, 5, 13, 4, 0).getTime();

  it('formats English as British English, not American', () => {
    expect(formattingLocale('en')).toBe('en-GB');
    expect(formatDateTime('en', evening)).toBe('29/09/2026, 22:17');
    expect(formatDate('en', evening)).toBe('29/09/2026');
    // "Sept" or "Sep" depending on the ICU data the runtime ships — both are British, and
    // which one is not ours to pin.
    expect(formatDateTimeMedium('en', evening)).toMatch(/^29 Sept? 2026, 22:17$/);
  });

  it('never writes a month-first date or a 12-hour clock in English', () => {
    for (const rendered of [formatDateTime('en', evening), formatDateTime('en', afternoon), formatDateTimeMedium('en', afternoon)]) {
      expect(rendered).not.toMatch(/\bAM\b|\bPM\b/i);
      expect(rendered).not.toMatch(/^0?9\/29\//); // month first
    }
    expect(formatDateTime('en', afternoon)).toBe('05/01/2026, 13:04');
  });

  it('falls back to British English for anything that is not a locale we ship', () => {
    expect(formattingLocale('en-US')).toBe('en-GB');
    expect(formattingLocale('')).toBe('en-GB');
  });

  it('leaves the other languages to their own conventions, on a 24-hour clock', () => {
    expect(formattingLocale('zh-Hant')).toBe('zh-Hant');
    expect(formattingLocale('de')).toBe('de');
    expect(formatDateTime('de', evening)).toBe('29.09.2026, 22:17');
    expect(formatDateTime('zh-Hant', evening)).not.toMatch(/上午|下午/);
  });
});

describe('no screen formats a date on its own', () => {
  // Every date the customer sees goes through src/shared/dateFormat.ts. A bare toLocaleString()
  // takes the computer's locale, which is how "9/29/2026, 10:17:07 PM" reached a British parent.
  it('the renderer calls no toLocale*String directly', () => {
    const offences: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.tsx?$/.test(entry.name)) {
          const source = fs.readFileSync(full, 'utf8');
          if (/\.toLocale(Date|Time)?String\s*\(/.test(source)) offences.push(path.relative(REPO, full));
        }
      }
    };
    walk(path.join(REPO, 'src/renderer'));
    expect(offences).toEqual([]);
  });

  /**
   * A screen must not reach into the main process for anything but a type.
   *
   * How this went wrong: a new panel needed the sticker-number rule and imported it from
   * `main/services/recordingManage`, which pulled `node:fs`, `node:crypto` and
   * `node:stream/promises` into the renderer bundle. The build failed, loudly, because the
   * renderer has no Node — but only because those modules happened to touch the filesystem. A
   * pure helper would have been bundled twice in silence. Shared logic belongs in `src/shared/`.
   */
  it('no renderer file imports main process code, except as a type', () => {
    const offences: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.tsx?$/.test(entry.name)) {
          for (const line of fs.readFileSync(full, 'utf8').split('\n')) {
            if (!/from\s+['"][^'"]*\/main\//.test(line)) continue;
            // `import type { X } from '../../main/...'` is erased at compile time and fine.
            if (/^\s*import\s+type\s/.test(line)) continue;
            offences.push(`${path.relative(REPO, full)}: ${line.trim()}`);
          }
        }
      }
    };
    walk(path.join(REPO, 'src/renderer'));
    expect(offences).toEqual([]);
  });
});
