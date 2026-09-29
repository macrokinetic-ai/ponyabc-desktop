import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import type { BookCatalogItemStatus, BookPenMatchStatus } from '../../src/shared/types';
import {
  CACHE_STATUS_LABELS,
  CACHE_STATUS_LEGEND_ORDER,
  CATALOG_STATUS_LABELS,
  CATALOG_STATUS_LEGEND_ORDER,
  PEN_STATUS_LABELS,
  PEN_STATUS_LEGEND_ORDER,
} from '../../src/renderer/screens/bookStatusLabels';

/**
 * The point of these: a status the user can see but nobody explained. The screen's labels and
 * its legend are generated from the same tables, so the only way to ship an unexplained status
 * is to add one to the union and forget the strings — which is exactly what these catch.
 */

const LOCALES_DIR = path.join(__dirname, '../../src/renderer/i18n/locales');
const LOCALES = fs.readdirSync(LOCALES_DIR).filter((d) => fs.statSync(path.join(LOCALES_DIR, d)).isDirectory());

function loadBook(locale: string): Record<string, Record<string, string>> {
  return JSON.parse(fs.readFileSync(path.join(LOCALES_DIR, locale, 'book.json'), 'utf8'));
}

function lookup(doc: Record<string, Record<string, string>>, dotted: string): string | undefined {
  const [section, key] = dotted.split('.');
  return doc[section]?.[key];
}

// Enumerated here rather than derived from the tables, so that adding a status to the union
// without adding it here also fails — the test must not learn the answer from the thing it tests.
const ALL_PEN_STATUSES: BookPenMatchStatus[] = [
  'present',
  'verifying',
  'verified-current',
  'verified-differs',
  'size-differs',
  'matched-hash-unknown',
  'awaiting-catalog',
  'unknown',
];
const ALL_CATALOG_STATUSES: BookCatalogItemStatus[] = [
  'not-on-pen',
  'on-pen-present',
  'on-pen-verifying',
  'on-pen-current',
  'on-pen-differs',
  'on-pen-size-differs',
  'metadata-incomplete',
  'ambiguous',
];

const ALL_KEYS = [
  ...Object.values(PEN_STATUS_LABELS),
  ...Object.values(CATALOG_STATUS_LABELS),
  ...Object.values(CACHE_STATUS_LABELS),
].flatMap((k) => [k.short, k.full, k.help]);

describe('book status labels — coverage', () => {
  it('has a short, full and help key for every pen status', () => {
    for (const status of ALL_PEN_STATUSES) {
      const keys = PEN_STATUS_LABELS[status];
      expect(keys, status).toBeDefined();
      expect(Object.values(keys).every((k) => k.length > 0), status).toBe(true);
    }
    expect(Object.keys(PEN_STATUS_LABELS).sort()).toEqual([...ALL_PEN_STATUSES].sort());
  });

  it('has a short, full and help key for every catalog status', () => {
    for (const status of ALL_CATALOG_STATUSES) {
      expect(Object.values(CATALOG_STATUS_LABELS[status]).every((k) => k.length > 0), status).toBe(true);
    }
    expect(Object.keys(CATALOG_STATUS_LABELS).sort()).toEqual([...ALL_CATALOG_STATUSES].sort());
  });

  it('lists every status in the legend exactly once', () => {
    expect([...PEN_STATUS_LEGEND_ORDER].sort()).toEqual([...ALL_PEN_STATUSES].sort());
    expect([...CATALOG_STATUS_LEGEND_ORDER].sort()).toEqual([...ALL_CATALOG_STATUSES].sort());
    expect([...CACHE_STATUS_LEGEND_ORDER].sort()).toEqual(Object.keys(CACHE_STATUS_LABELS).sort());
  });
});

describe('book status labels — translations', () => {
  it('ships every label in every locale', () => {
    const missing: string[] = [];
    for (const locale of LOCALES) {
      const doc = loadBook(locale);
      for (const key of ALL_KEYS) {
        if (!lookup(doc, key)?.trim()) missing.push(`${locale}: ${key}`);
      }
      for (const key of ['legend.title', 'legend.intro', 'legend.penHeading', 'legend.catalogHeading', 'legend.cacheHeading']) {
        if (!lookup(doc, key)?.trim()) missing.push(`${locale}: ${key}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('gives each status a help text distinct from its own label, in every locale', () => {
    // A help string copied from the label explains nothing; that is the likely shape of a lazy
    // translation, and it would silently pass the presence check above.
    const lazy: string[] = [];
    for (const locale of LOCALES) {
      const doc = loadBook(locale);
      for (const keys of [...Object.values(PEN_STATUS_LABELS), ...Object.values(CATALOG_STATUS_LABELS)]) {
        const help = lookup(doc, keys.help);
        if (help && (help === lookup(doc, keys.full) || help === lookup(doc, keys.short))) {
          lazy.push(`${locale}: ${keys.help}`);
        }
      }
    }
    expect(lazy).toEqual([]);
  });

  it('keeps the two "on pen" statuses distinguishable in English', () => {
    // 'present' and 'matched-hash-unknown' both mean "the file is there"; before this change
    // both short labels read "On pen", which hid the fact that one of them can never be
    // verified. They must not collapse to the same chip again.
    const en = loadBook('en');
    expect(lookup(en, PEN_STATUS_LABELS.present.short)).not.toBe(lookup(en, PEN_STATUS_LABELS['matched-hash-unknown'].short));
  });
});
