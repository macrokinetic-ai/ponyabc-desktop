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
export function demoBookList(): BookListResult {
  const now = Date.now();

  return {
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
      penFreeBytes: 9_400_000_000,
    },
  };
}

export const demoDataEnabled = (): boolean => process.env.PONYABC_DEMO_DATA === '1';
