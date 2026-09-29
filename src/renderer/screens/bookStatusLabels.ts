import type { BookCatalogItemStatus, BookPenMatchStatus } from '@shared/types';

/**
 * One source of truth for the i18n keys behind every status the Update Book Content screen
 * can show, so the row chip, the expanded detail and the on-screen legend can never drift
 * apart or leave a status undocumented.
 *
 * Each status has three strings:
 *   short — the chip on the collapsed row; a couple of words, no explanation
 *   full  — the one-line status in the expanded detail
 *   help  — WHY the App is saying this, in plain language: the condition that produced it,
 *           and what (if anything) the user should do. Shown in the legend, as the chip's
 *           tooltip, and in the expanded detail — the last of those matters because a
 *           `title` tooltip is unreachable by keyboard and on a touch screen.
 */

export interface BookStatusLabelKeys {
  short: string;
  full: string;
  help: string;
}

const keysFor = (camel: string): BookStatusLabelKeys => ({
  short: `statusShort.${camel}`,
  full: `status.${camel}`,
  help: `statusHelp.${camel}`,
});

/** Statuses for a file that is physically on the pen (left-hand pane). */
export const PEN_STATUS_LABELS: Record<BookPenMatchStatus, BookStatusLabelKeys> = {
  present: keysFor('present'),
  verifying: keysFor('verifying'),
  'verified-current': keysFor('verifiedCurrent'),
  'verified-differs': keysFor('verifiedDiffers'),
  'size-differs': keysFor('sizeDiffers'),
  'matched-hash-unknown': keysFor('matchedHashUnknown'),
  'awaiting-catalog': keysFor('awaitingCatalog'),
  unknown: keysFor('unknown'),
};

/** Statuses for an official catalog item, describing its presence on the pen (right-hand pane). */
export const CATALOG_STATUS_LABELS: Record<BookCatalogItemStatus, BookStatusLabelKeys> = {
  'not-on-pen': keysFor('notOnPen'),
  'on-pen-present': keysFor('onPenPresent'),
  'on-pen-verifying': keysFor('onPenVerifying'),
  'on-pen-current': keysFor('onPenCurrent'),
  'on-pen-differs': keysFor('onPenDiffers'),
  'on-pen-size-differs': keysFor('onPenSizeDiffers'),
  'metadata-incomplete': keysFor('metadataIncomplete'),
  ambiguous: keysFor('ambiguous'),
};

/**
 * The App's own local download cache — deliberately NOT a status. It answers a different
 * question ("is a copy on this computer?") and is independent of what is on the pen, which is
 * the single most common misreading of this screen.
 */
export const CACHE_STATUS_LABELS = {
  cached: { short: 'cacheStatus.cached', full: 'cacheStatus.cached', help: 'cacheHelp.cached' },
  notDownloaded: { short: 'cacheStatus.notDownloaded', full: 'cacheStatus.notDownloaded', help: 'cacheHelp.notDownloaded' },
  downloading: { short: 'cacheStatus.downloading', full: 'cacheStatus.downloading', help: 'cacheHelp.downloading' },
} as const satisfies Record<string, BookStatusLabelKeys>;

/**
 * Legend order — clearest-and-most-common first, then the ones that need explaining, then the
 * two that mean "something is wrong upstream, not with your pen". Not the declaration order of
 * the union, which is arbitrary.
 */
export const PEN_STATUS_LEGEND_ORDER: readonly BookPenMatchStatus[] = [
  'verified-current',
  'present',
  'matched-hash-unknown',
  'verified-differs',
  'size-differs',
  'verifying',
  'awaiting-catalog',
  'unknown',
];

export const CATALOG_STATUS_LEGEND_ORDER: readonly BookCatalogItemStatus[] = [
  'not-on-pen',
  'on-pen-current',
  'on-pen-present',
  'on-pen-differs',
  'on-pen-size-differs',
  'on-pen-verifying',
  'metadata-incomplete',
  'ambiguous',
];

export const CACHE_STATUS_LEGEND_ORDER = ['cached', 'notDownloaded', 'downloading'] as const;
