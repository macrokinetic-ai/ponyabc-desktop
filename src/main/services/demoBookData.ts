import type { BookListResult } from '@shared/types';

/**
 * Fixed, obviously-fake book data for screenshots and the manual.
 *
 * Off unless `PONYABC_DEMO_DATA=1`, which nothing in a shipped build ever sets. It exists
 * because the real screen is only worth photographing with a pen attached — and CI has no pen,
 * so every screenshot we had said "No pen detected" and showed none of the states a parent
 * actually meets.
 *
 * The data is chosen to show one of each thing the layout distinguishes: a book that is fine, a
 * book that needs updating, a book we did not put there, and two books that can be added — one
 * of them new since the last check.
 */
export type DemoVariant = 'summary' | 'uptodate' | 'nospace' | 'nospace-unknown' | 'syncing';

/**
 * Set once a demo sync has "finished", so the screen afterwards says what it would really say:
 * everything is on the pen and there is nothing left to do. Without it the summary would still
 * offer the same two books to add in the photograph taken after the sync.
 */
let demoSyncComplete = false;
export function markDemoSyncComplete(): void {
  demoSyncComplete = true;
}

export function demoBookList(variant: DemoVariant = 'summary'): BookListResult {
  const now = Date.now();

  const base: BookListResult = {
    status: 'ok',
    penItems: [
      {
        fileName: '0451.axb',
        sizeBytes: 288_000_000,
        contentId: 'demo-phonics',
        friendlyName: 'Phonics Cards',
        friendlyNameI18n: { en: 'Phonics Cards', 'zh-Hant': '拼音卡', 'zh-Hans': '拼音卡' },
        status: 'verified-current',
        removable: true,
        updatedAtMs: now - 40 * 24 * 3600 * 1000,
      },
      {
        fileName: '0452.axb',
        sizeBytes: 515_000_000,
        contentId: 'demo-art',
        friendlyName: 'Art for Little Ones',
        friendlyNameI18n: { en: 'Art for Little Ones', 'zh-Hant': '藝術啟蒙卡', 'zh-Hans': '艺术启蒙卡' },
        status: 'verified-differs',
        removable: true,
        updatedAtMs: now - 3 * 24 * 3600 * 1000,
      },
      {
        fileName: 'grandma-stories.axb',
        sizeBytes: 44_000_000,
        contentId: null,
        friendlyName: null,
        friendlyNameI18n: null,
        status: 'unknown',
        removable: false,
        updatedAtMs: null,
      },
    ],
    catalogItems: [
      {
        contentId: 'demo-phonics',
        filename: '0451.axb',
        friendlyName: 'Phonics Cards',
        friendlyNameI18n: { en: 'Phonics Cards', 'zh-Hant': '拼音卡', 'zh-Hans': '拼音卡' },
        sizeBytes: 288_000_000,
        status: 'on-pen-current',
        cached: true,
        actionable: false,
        updatedAtMs: now - 40 * 24 * 3600 * 1000,
        lifecycleState: 'active',
      },
      {
        contentId: 'demo-art',
        filename: '0452.axb',
        friendlyName: 'Art for Little Ones',
        friendlyNameI18n: { en: 'Art for Little Ones', 'zh-Hant': '藝術啟蒙卡', 'zh-Hans': '艺术启蒙卡' },
        sizeBytes: 515_000_000,
        status: 'on-pen-differs',
        cached: false,
        actionable: true,
        updatedAtMs: now - 3 * 24 * 3600 * 1000,
        lifecycleState: 'active',
      },
      {
        contentId: 'demo-rhymes',
        filename: '0453.axb',
        friendlyName: 'Cantonese Nursery Rhymes',
        friendlyNameI18n: { en: 'Cantonese Nursery Rhymes', 'zh-Hant': '粵語童謠卡', 'zh-Hans': '粤语童谣卡' },
        sizeBytes: 188_000_000,
        status: 'not-on-pen',
        cached: false,
        actionable: true,
        updatedAtMs: now - 200 * 24 * 3600 * 1000,
        lifecycleState: 'active',
      },
      {
        contentId: 'demo-dinosaurs',
        filename: '0454.axb',
        friendlyName: 'Dinosaur Puzzle Book',
        friendlyNameI18n: { en: 'Dinosaur Puzzle Book', 'zh-Hant': '恐龍拼圖書', 'zh-Hans': '恐龙拼图书' },
        sizeBytes: 43_000_000,
        status: 'not-on-pen',
        cached: false,
        actionable: true,
        updatedAtMs: now - 1 * 24 * 3600 * 1000,
        lifecycleState: 'active',
      },
    ],
    meta: {
      fetchedAtMs: now - 5 * 60 * 1000,
      source: 'live',
      offline: false,
      conflicts: [],
      lastCheck: { state: 'ok', atMs: now - 5 * 60 * 1000, httpStatus: 200, itemCount: 4, message: null, durationMs: 210 },
      // 'nospace' leaves far too little room for the 231 MB the plan would write, so the
      // refusal and its "you need about N more" message can be photographed.
      // 'nospace-unknown' is the filesystem refusing to say how much room is left: the sync is
      // blocked rather than started hopefully, which is the screen this photographs.
      penFreeBytes: variant === 'nospace-unknown' ? null : variant === 'nospace' ? 120_000_000 : 9_400_000_000,
      penTotalBytes: 15_900_000_000,
      penClusterBytes: 32_768,
    },
  };

  if (demoSyncComplete) {
    // What the screen says the moment a sync finishes: every book in the catalogue is now on
    // the pen, including the two that were only offered a minute ago.
    return {
      ...base,
      penItems: [
        ...base.catalogItems.map((i) => ({
          fileName: i.filename,
          sizeBytes: i.sizeBytes,
          contentId: i.contentId,
          friendlyName: i.friendlyName,
          friendlyNameI18n: i.friendlyNameI18n,
          status: 'verified-current' as const,
          removable: true,
          updatedAtMs: i.updatedAtMs,
        })),
        ...(base.penItems ?? []).filter((p) => p.contentId === null),
      ],
      catalogItems: base.catalogItems.map((i) => ({ ...i, status: 'on-pen-current' as const, actionable: false })),
    };
  }

  if (variant === 'uptodate') {
    // Everything matches: nothing to add, nothing to update.
    return {
      ...base,
      penItems: (base.penItems ?? []).map((p) => (p.contentId === 'demo-art' ? { ...p, status: 'verified-current' as const } : p)),
      catalogItems: base.catalogItems
        .filter((i) => i.contentId === 'demo-phonics' || i.contentId === 'demo-art')
        .map((i) => ({ ...i, status: 'on-pen-current' as const, actionable: false })),
    };
  }

  return base;
}

const VARIANTS: readonly DemoVariant[] = ['summary', 'uptodate', 'nospace', 'nospace-unknown', 'syncing'];

export const demoVariant = (): DemoVariant => {
  const v = process.env.PONYABC_DEMO_DATA;
  return VARIANTS.includes(v as DemoVariant) ? (v as DemoVariant) : 'summary';
};

export const demoDataEnabled = (): boolean => (process.env.PONYABC_DEMO_DATA ?? '') !== '';
