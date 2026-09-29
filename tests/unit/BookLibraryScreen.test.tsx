// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { initI18n } from '../../src/renderer/i18n';
import i18n from '../../src/renderer/i18n';
import { PenRootProvider } from '../../src/renderer/state/PenRootContext';
import { BookLibraryProvider } from '../../src/renderer/state/BookLibraryContext';
import { BookLibraryScreen } from '../../src/renderer/screens/BookLibraryScreen';
import type { BookCatalogItem, BookListResult, BookPenItem, PonyAbcApi } from '../../src/shared/types';
import { CACHE_STATUS_LABELS, CATALOG_STATUS_LABELS, PEN_STATUS_LABELS, SIMPLE_STATE_LABELS } from '../../src/renderer/screens/bookStatusLabels';

function catalogItem(overrides: Partial<BookCatalogItem> = {}): BookCatalogItem {
  return {
    contentId: 'b1',
    filename: '0451.axb',
    friendlyName: 'Book One',
    friendlyNameI18n: { en: 'Book One', 'zh-Hant': '第一本書' },
    sizeBytes: 1000,
    status: 'not-on-pen',
    cached: false,
    actionable: true,
    updatedAtMs: null,
    ...overrides,
  };
}

function penItem(overrides: Partial<BookPenItem> = {}): BookPenItem {
  return {
    fileName: '0451.axb',
    sizeBytes: 1000,
    contentId: 'b1',
    friendlyName: 'Book One',
    friendlyNameI18n: { en: 'Book One', 'zh-Hant': '第一本書' },
    status: 'verified-current',
    removable: true,
    updatedAtMs: null,
    ...overrides,
  };
}

const okLastCheck = { state: 'ok' as const, atMs: 1_700_000_000_000, httpStatus: 200, itemCount: 1, message: null, durationMs: 5 };

function listResult(overrides: Partial<BookListResult> = {}): BookListResult {
  return {
    status: 'ok',
    penItems: [],
    catalogItems: [catalogItem()],
    meta: { fetchedAtMs: 1_700_000_000_000, source: 'live', offline: false, conflicts: [], lastCheck: okLastCheck },
    ...overrides,
  };
}

let progressListener: ((event: unknown) => void) | null = null;
let verifyListener: ((event: unknown) => void) | null = null;
let verifyProgressListener: ((event: unknown) => void) | null = null;
let downloadBatchSummaryListener: ((event: unknown) => void) | null = null;

function mockPonyAbc(overrides: Partial<PonyAbcApi> = {}): PonyAbcApi {
  return {
    platform: 'darwin',
    openRegistrationPage: vi.fn(async () => ({ ok: true })),
    scanForPenRoot: vi.fn(async () => ({ status: 'none' })),
    chooseCandidatePenRoot: vi.fn(async () => ({ status: 'none' })),
    selectPenRoot: vi.fn(async () => ({ status: 'cancelled' })),
    listDiyRecordings: vi.fn(async () => ({ status: 'no-pen-selected' })),
    onPenVolumesChanged: vi.fn(() => () => {}),
    selectComputerFolder: vi.fn(async () => ({ status: 'cancelled' })),
    restoreComputerFolder: vi.fn(async () => ({ status: 'none' })),
    listComputerFolder: vi.fn(async () => ({ status: 'no-folder-selected' })),
    copyRecordingsToComputer: vi.fn(async () => ({ status: 'completed', succeeded: [], renamed: [], failed: [] })),
    planTransferToPen: vi.fn(async () => ({ status: 'no-pen-selected' })),
    executeTransferToPen: vi.fn(async () => ({ status: 'no-pen-selected', added: [], replaced: [], skipped: [], failed: [] })),
    planReplaceSticker: vi.fn(async () => ({ status: 'no-pen-selected' })),
    executeReplaceSticker: vi.fn(async () => ({ status: 'error' })),
    onTransferProgress: vi.fn(() => () => {}),
    readAudioPreview: vi.fn(async () => ({ status: 'not-found' })),
    bookList: vi.fn(async () => listResult()),
    bookCatalogRefresh: vi.fn(async () => listResult()),
    bookAdd: vi.fn(async () => ({ status: 'completed' })),
    bookUpdate: vi.fn(async () => ({ status: 'completed' })),
    bookReinstall: vi.fn(async () => ({ status: 'completed' })),
    bookRemove: vi.fn(async () => ({ status: 'completed', freedBytes: 1000 })),
    bookBackups: vi.fn(async () => []),
    bookRestore: vi.fn(async () => ({ status: 'completed' })),
    bookDownloadCancel: vi.fn(async () => ({ ok: true })),
    onBookDownloadProgress: vi.fn((listener) => {
      progressListener = listener as (event: unknown) => void;
      return () => {
        progressListener = null;
      };
    }),
    onBookWriteProgress: vi.fn(() => () => {}),
    bookIndexStatus: vi.fn(async () => ({ recordCount: 1, bookCount: 1, malformed: false, appleDoubleFiles: [], hasDsStore: false, status: 'ok', resetPending: false })),
    bookIndexCommit: vi.fn(async () => ({ status: 'not-needed' })),
    bookIndexFix: vi.fn(async () => ({ status: 'reset', deleted: ['1.BIN', 'BOOKFILE.BIN'], ejected: false })),
    bookDownloadBatch: vi.fn(async () => ({ status: 'started' })),
    bookDownloadBatchCancel: vi.fn(async () => ({ ok: true })),
    onBookDownloadBatchSummary: vi.fn((listener) => {
      downloadBatchSummaryListener = listener as (event: unknown) => void;
      return () => {
        downloadBatchSummaryListener = null;
      };
    }),
    onBookVerifyUpdate: vi.fn((listener) => {
      verifyListener = listener as (event: unknown) => void;
      return () => {
        verifyListener = null;
      };
    }),
    bookVerifyContent: vi.fn(async () => ({ status: 'started' })),
    bookVerifyCancel: vi.fn(async () => ({ ok: true })),
    onBookVerifyProgress: vi.fn((listener) => {
      verifyProgressListener = listener as (event: unknown) => void;
      return () => {
        verifyProgressListener = null;
      };
    }),
    getSettings: vi.fn(async () => ({ version: 1, locale: 'en', lastPenRootPath: null, lastComputerFolderPath: null })),
    setSettings: vi.fn(async () => ({ version: 1, locale: 'en', lastPenRootPath: null, lastComputerFolderPath: null })),
    getAppInfo: vi.fn(async () => ({ version: '0.0.0', variant: 'mac-arm64' })),
    checkForUpdates: vi.fn(async () => ({ status: 'up-to-date', currentVersion: '0.0.0' })),
    openLatestReleasePage: vi.fn(async () => ({ ok: true })),
    ...overrides,
  } as PonyAbcApi;
}

beforeAll(async () => {
  await initI18n('en');
});

/** jsdom's localStorage is not writable in this setup; the badge only needs get/set/clear. */
function installFakeLocalStorage() {
  const map = new Map<string, string>();
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, String(v)),
      removeItem: (k: string) => void map.delete(k),
      clear: () => map.clear(),
      key: () => null,
      length: 0,
    },
  });
}

beforeEach(() => {
  installFakeLocalStorage();
  progressListener = null;
  verifyListener = null;
  verifyProgressListener = null;
  downloadBatchSummaryListener = null;
  // @ts-expect-error — test-only global shim for the preload bridge
  window.ponyabc = mockPonyAbc();
});

afterEach(() => {
  cleanup();
  void i18n.changeLanguage('en');
});

function renderWithPen(penConnected: boolean) {
  if (penConnected) {
    window.ponyabc.scanForPenRoot = vi.fn(async () => ({ status: 'ok', path: '/Volumes/PEN', volumeLabel: 'PEN', generation: 1, auto: true }));
  }
  render(
    <PenRootProvider>
      <BookLibraryProvider>
        <BookLibraryScreen />
      </BookLibraryProvider>
    </PenRootProvider>,
  );
}

async function renderScreen(list: BookListResult = listResult({ penItems: [penItem()] })) {
  window.ponyabc.bookList = vi.fn(async () => list);
  window.ponyabc.bookCatalogRefresh = vi.fn(async () => list);
  renderWithPen(true);
  // "Book One" can legitimately appear in both panes at once — wait for at least one.
  await screen.findAllByText('Book One');
}

/** The section whose <h2> is `heading` — the layout is one column of named sections now. */
function sectionByHeading(heading: string): HTMLElement {
  const h = [...document.querySelectorAll('h2')].find((el) => el.textContent?.trim() === heading);
  if (!h) throw new Error(`no section headed "${heading}"`);
  return h.closest('section') as HTMLElement;
}

/**
 * The screen a parent actually uses, top to bottom:
 *   Check for new books → Your books → New books → one footer that says how long and does it.
 *
 * The guarantees that matter most here are absences: a parent can never delete a book, a book
 * already on the pen never appears under "New books", and books we did not put there are never
 * offered an action.
 */

describe('BookLibraryScreen — what a parent can and cannot do', () => {
  it('offers NO way to delete a book, anywhere on the screen', async () => {
    await renderScreen(
      listResult({
        penItems: [penItem(), penItem({ fileName: '0452.axb', contentId: 'b2', friendlyName: 'Book Two' })],
        catalogItems: [catalogItem(), catalogItem({ contentId: 'b3', filename: '0453.axb', friendlyName: 'Book Three', status: 'not-on-pen' })],
      }),
    );

    const forbidden = /remove|delete|erase|\bbin\b/i;
    for (const el of document.querySelectorAll('button, [role="button"], a, summary')) {
      expect(el.textContent ?? '', el.outerHTML).not.toMatch(forbidden);
    }
    expect(window.ponyabc.bookRemove).not.toHaveBeenCalled();
  });

  it('never lists a book that is already on the pen under "New books"', async () => {
    // Same contentId on both sides — the catalogue says on-pen, the pen has the file.
    await renderScreen(
      listResult({
        penItems: [penItem({ contentId: 'b1' })],
        catalogItems: [catalogItem({ contentId: 'b1', status: 'on-pen-current', actionable: false })],
      }),
    );

    const newSection = sectionByHeading('New books');
    expect(newSection.textContent).toContain('Your pen already has every book we offer.');
    expect(newSection.querySelectorAll('input[type="checkbox"]')).toHaveLength(0);
  });

  it('shows books we did not put there once, counted, with nothing to press', async () => {
    await renderScreen(
      listResult({
        penItems: [
          penItem(),
          penItem({ fileName: 'mystery.axb', contentId: null, friendlyName: null, friendlyNameI18n: null, status: 'unknown', removable: false }),
          penItem({ fileName: 'other.axb', contentId: null, friendlyName: null, friendlyNameI18n: null, status: 'unknown', removable: false }),
        ],
      }),
    );

    const yours = sectionByHeading('Your books');
    await screen.findByText('Other books (not from PonyABC)');
    expect(yours.textContent).toContain('2 book(s)');
    expect(yours.textContent).toContain('This app leaves them exactly as they are.');
    // Named once — not one row each, and no action against any of them.
    expect(screen.getAllByText('Other books (not from PonyABC)')).toHaveLength(1);
    expect(yours.textContent).not.toContain('mystery.axb');
  });
});

describe('BookLibraryScreen — Your books', () => {
  it('says "Up to date" for a book that matches', async () => {
    await renderScreen(
      listResult({ penItems: [penItem({ contentId: 'b1' })], catalogItems: [catalogItem({ contentId: 'b1', status: 'on-pen-current', actionable: false })] }),
    );
    expect(sectionByHeading('Your books').textContent).toContain('Up to date');
  });

  it('offers Update, and only Update, for a book that differs', async () => {
    await renderScreen(
      listResult({
        penItems: [penItem({ contentId: 'b1', status: 'verified-differs' })],
        catalogItems: [catalogItem({ contentId: 'b1', status: 'on-pen-differs', actionable: true })],
      }),
    );

    const yours = sectionByHeading('Your books');
    expect(yours.textContent).toContain('Update available');
    expect(within(yours).getByRole('button', { name: 'Update' })).toBeTruthy();
    expect(yours.querySelectorAll('input[type="checkbox"]')).toHaveLength(0);
  });

  it('updating one book goes straight to the Replace/Skip question', async () => {
    await renderScreen(
      listResult({
        penItems: [penItem({ contentId: 'b1', status: 'verified-differs' })],
        catalogItems: [catalogItem({ contentId: 'b1', status: 'on-pen-differs', actionable: true })],
      }),
    );

    fireEvent.click(within(sectionByHeading('Your books')).getByRole('button', { name: 'Update' }));
    await screen.findByText('Some selected items differ from the pen');
  });
});

describe('BookLibraryScreen — New books', () => {
  it('lists an addable book with its size and how long it will take', async () => {
    await renderScreen(
      listResult({ penItems: [], catalogItems: [catalogItem({ status: 'not-on-pen', sizeBytes: 300_000_000 })] }),
    );
    const section = sectionByHeading('New books');
    expect(section.textContent).toMatch(/286(\.\d)? MB/);
    // 300 MB + the 16 MB read-back at 978 kB/s ≈ 5.4 min.
    expect(section.textContent).toMatch(/about 6 min/);
  });

  it('the footer counts the selection and totals the time, then adds', async () => {
    await renderScreen(listResult({ penItems: [], catalogItems: [catalogItem({ status: 'not-on-pen', sizeBytes: 300_000_000 })] }));

    expect(screen.getByText('Tick a book above to add it.')).toBeTruthy();
    fireEvent.click(sectionByHeading('New books').querySelector('input[type="checkbox"]') as Element);

    await screen.findByText(/1 book\(s\) selected, about 6 minutes/);
    fireEvent.click(screen.getByRole('button', { name: 'Add to your pen' }));
    await waitFor(() => expect(window.ponyabc.bookAdd).toHaveBeenCalled());
  });
});

describe('BookLibraryScreen — the NEW badge', () => {
  it('badges nothing the first time a catalogue is seen', async () => {
    localStorage.clear();
    await renderScreen(listResult({ penItems: [], catalogItems: [catalogItem({ status: 'not-on-pen' })] }));
    expect(screen.queryByText('NEW')).toBeNull();
  });

  it('badges a book that arrived since the last look, once, then never again', async () => {
    localStorage.setItem('ponyabc.book.seenCatalogIds.v1', JSON.stringify(['b1']));
    const list = listResult({
      penItems: [],
      catalogItems: [catalogItem({ contentId: 'b1', status: 'not-on-pen' }), catalogItem({ contentId: 'b2', filename: '0452.axb', friendlyName: 'Book Two', status: 'not-on-pen' })],
    });

    await renderScreen(list);
    expect(screen.getAllByText('NEW')).toHaveLength(1);

    // Re-open the screen: it has now been seen, so it is an ordinary book.
    cleanup();
    await renderScreen(list);
    expect(screen.queryByText('NEW')).toBeNull();
  });
});

describe('BookLibraryScreen — after a change', () => {
  it('tells the parent to restart the pen after adding a book', async () => {
    await renderScreen(listResult({ penItems: [], catalogItems: [catalogItem({ status: 'not-on-pen' })] }));
    window.ponyabc.bookIndexCommit = vi.fn(async () => ({ status: 'reset', deleted: ['1.BIN', 'BOOKFILE.BIN'], ejected: false }));

    fireEvent.click(sectionByHeading('New books').querySelector('input[type="checkbox"]') as Element);
    fireEvent.click(screen.getByRole('button', { name: 'Add to your pen' }));

    await screen.findByText('All done!');
    await screen.findByText(/Please unplug your pen, then switch it off and on again/);
  });

  it('does NOT tell them to restart after updating a book in place', async () => {
    await renderScreen(
      listResult({
        penItems: [penItem({ contentId: 'b1', status: 'verified-differs' })],
        catalogItems: [catalogItem({ contentId: 'b1', status: 'on-pen-differs', actionable: true })],
      }),
    );
    window.ponyabc.bookIndexCommit = vi.fn(async () => ({ status: 'not-needed' }));

    fireEvent.click(within(sectionByHeading('Your books')).getByRole('button', { name: 'Update' }));
    fireEvent.click((await screen.findAllByRole('radio', { name: 'Replace' }))[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));

    await screen.findByText('All done! Your book has been updated.');
    expect(screen.queryByText(/switch it off and on again/)).toBeNull();
  });

  it('a failed add leaves the pen list alone and says why', async () => {
    await renderScreen(listResult({ penItems: [], catalogItems: [catalogItem({ status: 'not-on-pen' })] }));
    window.ponyabc.bookAdd = vi.fn(async () => ({ status: 'no-space' }));
    window.ponyabc.bookIndexCommit = vi.fn(async () => ({ status: 'not-needed' }));

    fireEvent.click(sectionByHeading('New books').querySelector('input[type="checkbox"]') as Element);
    fireEvent.click(screen.getByRole('button', { name: 'Add to your pen' }));

    await screen.findByText('Not enough free space to complete this.');
    expect(window.ponyabc.bookIndexCommit).not.toHaveBeenCalled();
  });

  it('offers to fix a book list that no longer matches the pen, and never does it on its own', async () => {
    window.ponyabc.bookIndexStatus = vi.fn(async () => ({
      recordCount: 2, bookCount: 3, malformed: false, appleDoubleFiles: [], hasDsStore: false, status: 'mismatch', resetPending: false,
    }));
    await renderScreen();

    await screen.findByText("Your pen's book list needs a moment");
    expect(window.ponyabc.bookIndexFix).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: "Fix my pen's book list" }));
    await waitFor(() => expect(window.ponyabc.bookIndexFix).toHaveBeenCalled());
  });
});

describe('BookLibraryScreen — plain language', () => {
  it('never shows a parent a filename, a checksum or a hash in the main view', async () => {
    await renderScreen(
      listResult({
        penItems: [penItem({ contentId: 'b1', status: 'matched-hash-unknown' })],
        catalogItems: [catalogItem({ contentId: 'b2', filename: '0452.axb', friendlyName: 'Book Two', status: 'not-on-pen' })],
      }),
    );
    const text = document.body.textContent ?? '';
    expect(text).not.toMatch(/checksum|hash|SHA-?256|\.axb|catalog entry/i);
  });

  it('keeps the technical wording available, inside a closed disclosure', async () => {
    await renderScreen();
    await screen.findByText('What do these words mean?');
    const details = document.querySelector('details.status-legend') as HTMLDetailsElement;
    details.open = true;
    fireEvent(details, new Event('toggle'));

    for (const keys of Object.values(SIMPLE_STATE_LABELS)) {
      expect(screen.getAllByText(i18n.t(keys.help, { ns: 'book' })).length, keys.help).toBeGreaterThan(0);
    }

    const advanced = document.querySelector('details.status-legend details.advanced-details') as HTMLDetailsElement;
    advanced.open = true;
    fireEvent(advanced, new Event('toggle'));
    for (const keys of [...Object.values(PEN_STATUS_LABELS), ...Object.values(CATALOG_STATUS_LABELS), ...Object.values(CACHE_STATUS_LABELS)]) {
      expect(screen.getAllByText(i18n.t(keys.help, { ns: 'book' })).length, keys.help).toBeGreaterThan(0);
    }
  });
});

describe('BookLibraryScreen — checking for new books', () => {
  it('leads with a plain "Check for new books" button and when it last ran', async () => {
    await renderScreen();
    expect(screen.getByRole('button', { name: 'Check for new books' })).toBeTruthy();
    expect(document.body.textContent).toMatch(/Last checked:/);
  });

  it('checking calls the catalogue refresh, not a pen scan', async () => {
    await renderScreen();
    fireEvent.click(screen.getByRole('button', { name: 'Check for new books' }));
    await waitFor(() => expect(window.ponyabc.bookCatalogRefresh).toHaveBeenCalled());
  });
});

describe('BookLibraryScreen — catalogue status', () => {
  it('tells the parent plainly when the check could not reach us', async () => {
    await renderScreen(
      listResult({ meta: { fetchedAtMs: null, source: 'none', offline: true, conflicts: [], lastCheck: { state: 'error', atMs: 1, httpStatus: null, itemCount: null, message: 'offline', durationMs: 1 } } }),
    );
    await screen.findByText("We couldn't reach the PonyABC library. Check your internet connection and try again.");
  });

  it('renders an ambiguous-conflict notice when the catalog reports one', async () => {
    await renderScreen(
      listResult({ meta: { fetchedAtMs: 1, source: 'live', offline: false, conflicts: [{ filenameLower: 'a.axb', contentIds: ['b1', 'b2'] }], lastCheck: okLastCheck } }),
    );
    await screen.findByText(/share a filename/);
  });

  it('shows the dev-fixture banner only when the catalog source is "fixture"', async () => {
    await renderScreen(listResult({ meta: { fetchedAtMs: 1, source: 'fixture', offline: false, conflicts: [], lastCheck: okLastCheck } }));
    await screen.findByText('Development catalog data — not live');
  });
});
