import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Both Chinese locales must be **standard written Chinese** (書面語), not colloquial Cantonese.
 *
 * This is not pedantry about dialect. These strings are what a parent in a nursery reads, and
 * spoken-Cantonese spelling in a printed interface reads as sloppy in exactly the places we are
 * asking someone to trust us with their child's recordings. It is also unreadable to a customer
 * in Taiwan or Singapore, who gets the same zh-Hant build.
 *
 * Several colloquial forms had reached shipped strings — 「買咗新書？喺下面清單搵到佢」 — so
 * this guards against them coming back one string at a time.
 */

const LOCALES_DIR = path.join(__dirname, '../../src/renderer/i18n/locales');
const CHINESE_LOCALES = ['zh-Hant', 'zh-Hans'];

/**
 * Characters that essentially only appear when writing Cantonese as it is spoken. Each is a
 * giveaway on its own, so a single occurrence is enough to fail.
 */
const COLLOQUIAL_CHARS = [
  '咗', // perfective aspect marker — standard: 了
  '喺', // at/in — standard: 在
  '佢', // he/she/it — standard: 他/她/它
  '嗰', // that — standard: 那
  '嘅', // possessive — standard: 的
  '唔', // not — standard: 不
  '冇', // not have — standard: 沒有
  '嘢', // thing — standard: 東西
  '睇', // look/watch — standard: 看
  '俾',
  '畀', // give — standard: 給
  '諗', // think — standard: 想
  '攞', // take — standard: 拿
  '嘥', // waste — standard: 浪費
  '乜', // what — standard: 什麼
  '啲', // plural/some — standard: 些
  '搵', // find — standard: 找
  '嚟', // come — standard: 來
  '咁', // so/such — standard: 這麼
  '喎',
  '嘞',
];

/**
 * Multi-character forms whose individual characters are perfectly standard but whose combination
 * is Cantonese. 呢, for instance, is an ordinary sentence-final particle in Mandarin; 呢個 is not.
 */
const COLLOQUIAL_SEQUENCES = ['呢個', '呢啲', '呢度', '而家', '依家', '傳返', '返嚟'];

/**
 * 係 is the awkward one: the Cantonese copula, but also half of perfectly standard words. Only
 * flag it outside those.
 */
const STANDARD_USES_OF_HAI = ['關係', '係數', '聯係', '干係'];

interface Offence {
  location: string;
  found: string;
  value: string;
}

function collectStrings(doc: unknown, prefix: string, out: Array<[string, string]>): void {
  if (typeof doc === 'string') {
    out.push([prefix, doc]);
    return;
  }
  if (doc && typeof doc === 'object') {
    for (const [key, value] of Object.entries(doc)) {
      collectStrings(value, prefix ? `${prefix}.${key}` : key, out);
    }
  }
}

function scan(locale: string): Offence[] {
  const dir = path.join(LOCALES_DIR, locale);
  const offences: Offence[] = [];

  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith('.json')) continue;
    const doc: unknown = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    const strings: Array<[string, string]> = [];
    collectStrings(doc, '', strings);

    for (const [key, value] of strings) {
      const location = `${locale}/${file} ${key}`;

      for (const char of COLLOQUIAL_CHARS) {
        if (value.includes(char)) offences.push({ location, found: char, value });
      }
      for (const seq of COLLOQUIAL_SEQUENCES) {
        if (value.includes(seq)) offences.push({ location, found: seq, value });
      }

      if (value.includes('係')) {
        let remaining = value;
        for (const standard of STANDARD_USES_OF_HAI) remaining = remaining.split(standard).join('');
        if (remaining.includes('係')) offences.push({ location, found: '係 (as a copula)', value });
      }
    }
  }
  return offences;
}

describe('Chinese locales are standard written Chinese', () => {
  for (const locale of CHINESE_LOCALES) {
    it(`${locale} contains no colloquial Cantonese`, () => {
      const offences = scan(locale);
      // Printed as a readable list: a bare "expected 3 to be 0" would send the next person
      // hunting through eight JSON files for characters they may not recognise.
      expect(offences.map((o) => `${o.location} — ${o.found} — ${o.value}`)).toEqual([]);
    });
  }

  it('recognises a colloquial string when it sees one', () => {
    // Guards the guard: if the character list were emptied or the scan silently stopped
    // reading files, every locale would "pass" and nobody would notice.
    const sample = '買咗新書？喺下面清單搵到佢';
    const found = COLLOQUIAL_CHARS.filter((c) => sample.includes(c));
    expect(found).toEqual(expect.arrayContaining(['咗', '喺', '搵', '佢']));
  });

  it('does not flag 係 inside ordinary words', () => {
    const value = '這與韌體版本沒有關係。';
    let remaining = value;
    for (const standard of STANDARD_USES_OF_HAI) remaining = remaining.split(standard).join('');
    expect(remaining.includes('係')).toBe(false);
  });
});

/**
 * The pen has one name in Chinese, and it is not "錄音筆".
 *
 * 點讀筆 / 点读笔 is a reading pen — you touch it to a book and it reads aloud. 錄音筆 / 录音笔 is a
 * voice recorder, a different product in a different aisle. The app said 點讀筆 everywhere until
 * rc6 added twenty-one strings about recordings and backups that said 錄音筆, because the screens
 * they were written for are about recordings. The product is still a reading pen.
 *
 * Both forms are in the test so neither script can drift on its own.
 */
describe('what the pen is called in Chinese', () => {
  /**
   * The official product name, decided by the owner on 1 October 2026:
   *
   *   繁體中文  點讀錄音筆      简体中文  点读录音笔
   *   English  Intelligent Recording Reading Pen, model P5
   *   full     PonyABC P5 Intelligent Recording Reading Pen
   *
   * It reads AND records, and the name says both. Two earlier names are now wrong:
   *
   *   點讀筆 / 点读笔   — reading only; what the app said until rc7
   *   錄音筆 / 录音笔   — recording only; what I wrongly wrote into rc6's new strings
   *
   * The catch is that the right name CONTAINS the wrong one: 點讀錄音筆 ends in 錄音筆. A plain
   * search for 錄音筆 matches every correct name, so this uses a negative lookbehind — 錄音筆 is
   * an offence only when 點讀 is not immediately before it.
   */
  const WRONG_ALONE = { 'zh-Hant': /(?<!點讀)錄音筆/, 'zh-Hans': /(?<!点读)录音笔/ } as const;
  const OLD_READING_ONLY = { 'zh-Hant': /點讀筆/, 'zh-Hans': /点读笔/ } as const;
  const OFFICIAL = { 'zh-Hant': '點讀錄音筆', 'zh-Hans': '点读录音笔' } as const;

  for (const locale of ['zh-Hant', 'zh-Hans'] as const) {
    const files = () =>
      fs.readdirSync(path.join(LOCALES_DIR, locale)).map((f) => ({
        name: `${locale}/${f}`,
        text: fs.readFileSync(path.join(LOCALES_DIR, locale, f), 'utf8'),
      }));

    it(`${locale} never calls it a recording pen alone`, () => {
      expect(files().filter((f) => WRONG_ALONE[locale].test(f.text)).map((f) => f.name)).toEqual([]);
    });

    it(`${locale} never uses the old reading-only name`, () => {
      expect(files().filter((f) => OLD_READING_ONLY[locale].test(f.text)).map((f) => f.name)).toEqual([]);
    });

    it(`${locale} does use the official name`, () => {
      // Guards the obvious wrong fix: deleting the word rather than correcting it.
      expect(files().some((f) => f.text.includes(OFFICIAL[locale]))).toBe(true);
    });

    it(`${locale}'s home header is the full product name`, () => {
      const home = JSON.parse(fs.readFileSync(path.join(LOCALES_DIR, locale, 'home.json'), 'utf8'));
      expect(home.kicker).toContain('PonyABC P5');
      expect(home.kicker).toContain(OFFICIAL[locale]);
    });
  }

  it('the negative lookbehind really does distinguish the two', () => {
    // If this ever stops holding, the first test above silently passes everything.
    expect(WRONG_ALONE['zh-Hant'].test('點讀錄音筆')).toBe(false);
    expect(WRONG_ALONE['zh-Hant'].test('錄音筆')).toBe(true);
    expect(WRONG_ALONE['zh-Hans'].test('点读录音笔')).toBe(false);
    expect(WRONG_ALONE['zh-Hans'].test('录音笔')).toBe(true);
  });
});
