import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Every screen in eight languages.
 *
 * A key that exists in English and nowhere else does not break: i18next falls back to English,
 * so the screen works and a parent reading German meets an English sentence in the middle of it.
 * That is exactly the kind of gap that survives for months, which is why it is measured here.
 *
 * `KNOWN_UNTRANSLATED` is the list of gaps that already existed, and it is deliberately a list of
 * exact keys rather than a prefix: the privacy and copyright BODIES are English in all seven
 * other languages while their headings are translated, so those screens read half-translated
 * today. Translating them is the owner's call, not this test's — a privacy policy is a legal
 * statement and machine-translating one quietly is not a thing to do on someone's behalf. What
 * this test does guarantee is that the list cannot grow: any new key must land in all eight.
 */

const REPO = path.resolve(__dirname, '../..');
const BASE = path.join(REPO, 'src/renderer/i18n/locales');

const KNOWN_UNTRANSLATED = new Set([
  'settings.json:legal.privacy.companyLine',
  'settings.json:legal.privacy.localBody',
  'settings.json:legal.privacy.networkBookBody',
  'settings.json:legal.privacy.networkDiagnosticsBody',
  'settings.json:legal.privacy.networkUpdateBody',
  'settings.json:legal.privacy.registrationBody',
  'settings.json:legal.privacy.retentionBody',
  'settings.json:legal.privacy.rightsBody',
  'settings.json:legal.legalCopyright.diyBody',
  'settings.json:legal.legalCopyright.materialsBody',
  'settings.json:legal.legalCopyright.termsNotice',
  'settings.json:legal.legalCopyright.thirdPartyBody',
  'settings.json:legal.legalCopyright.trademarkBody',
]);

function flatten(value: unknown, prefix = ''): Record<string, string> {
  if (value !== null && typeof value === 'object') {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      Object.assign(out, flatten(v, prefix ? `${prefix}.${k}` : k));
    }
    return out;
  }
  return { [prefix]: String(value) };
}

const read = (locale: string, file: string) =>
  flatten(JSON.parse(fs.readFileSync(path.join(BASE, locale, file), 'utf8')));

const locales = fs.readdirSync(BASE).filter((l) => l !== 'en').sort();
const files = fs.readdirSync(path.join(BASE, 'en')).sort();

describe('eight languages, all of them complete', () => {
  it('has the same eight locales it claims to', () => {
    expect([...locales, 'en'].sort()).toEqual(['de', 'en', 'es', 'fr', 'it', 'pt', 'zh-Hans', 'zh-Hant']);
  });

  it('translates every English key, apart from the legal bodies that were already English', () => {
    const gaps: string[] = [];
    for (const file of files) {
      const en = read('en', file);
      for (const locale of locales) {
        const other = read(locale, file);
        for (const key of Object.keys(en)) {
          // An `_one` form is legitimately absent where the language has a single plural form.
          if (key.endsWith('_one')) continue;
          if (key in other) continue;
          const id = `${file}:${key}`;
          if (KNOWN_UNTRANSLATED.has(id)) continue;
          gaps.push(`${locale} ${id}`);
        }
      }
    }
    expect(gaps).toEqual([]);
  });

  it('carries no key the English does not have, so nothing is translated into a dead end', () => {
    const orphans: string[] = [];
    for (const file of files) {
      const enKeys = new Set(Object.keys(read('en', file)));
      for (const locale of locales) {
        for (const key of Object.keys(read(locale, file))) {
          // Plural forms are the one legitimate divergence in both directions.
          if (key.endsWith('_one') || key.endsWith('_other')) continue;
          if (!enKeys.has(key)) orphans.push(`${locale} ${file}:${key}`);
        }
      }
    }
    expect(orphans).toEqual([]);
  });

  it('every known gap is still a real gap, so the list shrinks when one is filled', () => {
    // A stale allowance is how an exception list stops meaning anything.
    const stale: string[] = [];
    for (const id of KNOWN_UNTRANSLATED) {
      const [file, key] = id.split(':');
      const en = read('en', file);
      if (!(key in en)) {
        stale.push(`${id} (no longer in English)`);
        continue;
      }
      if (locales.every((l) => key in read(l, file))) stale.push(`${id} (now translated everywhere)`);
    }
    expect(stale).toEqual([]);
  });
});
