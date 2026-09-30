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
    state: 'active',
    minAppVersion: null,
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
    bookBatchBegin: vi.fn(async () => ({ ok: true })),
    bookBatchEnd: vi.fn(async () => ({ status: 'not-needed' })),
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
  // Wait for the LOADED state, not merely for the screen to exist. The Sync button renders
  // immediately with empty data, so waiting on it let assertions run before bookList resolved —
  // which passed on this machine and failed on a slower Windows runner. "Last checked" only
  // appears once a fetched catalogue is in hand.
  await screen.findByText(/Last checked:/);
}

/**
 * One button. A parent does not choose books and cannot delete them; they press **Sync books**
 * and the pen ends up matching the library. These tests pin what that button does, what it
 * refuses to do, and the two things a parent must be told before it runs: how long, and whether
 * there is room.
 */

describe('BookLibraryScreen — what a parent can and cannot do', () => {
  it('offers NO way to delete a book, and no way to pick one', async () => {
    await renderScreen(
      listResult({
        penItems: [penItem(), penItem({ fileName: '0452.axb', contentId: 'b2', friendlyName: 'Book Two' })],
        catalogItems: [catalogItem({ contentId: 'b3', filename: '0453.axb', friendlyName: 'Book Three', status: 'not-on-pen' })],
      }),
    );

    for (const el of document.querySelectorAll('button, [role="button"], a')) {
      expect(el.textContent ?? '', el.outerHTML).not.toMatch(/remove|delete|erase|\bbin\b/i);
    }
    // No selection of any kind: no checkboxes, no "select all", no per-book Add.
    expect(document.querySelectorAll('input[type="checkbox"]')).toHaveLength(0);
    expect(screen.queryByText(/select all/i)).toBeNull();
    expect(window.ponyabc.bookRemove).not.toHaveBeenCalled();
  });

  it('says in plain words whether the pen is connected', async () => {
    await renderScreen();
    await screen.findByText('Your pen is connected');
    expect(document.body.textContent).not.toMatch(/C:\\|missing the BOOK and DIY folders/);
  });

  it('keeps drive letters and per-book checks under Advanced details', async () => {
    await renderScreen();
    const advanced = [...document.querySelectorAll('details.advanced-details')];
    expect(advanced.length).toBeGreaterThan(0);
    expect(advanced.every((d) => !(d as HTMLDetailsElement).open)).toBe(true);
    // Verify still exists — for support, one disclosure away rather than gone.
    expect(document.body.textContent).toContain('Verify this file');
  });
});

describe('BookLibraryScreen — the summary', () => {
  it('counts the books on the pen and what sync would do, with a time', async () => {
    await renderScreen(
      listResult({
        penItems: [penItem({ contentId: 'b1' }), penItem({ fileName: '0453.axb', contentId: 'b3', friendlyName: 'Book Three' })],
        catalogItems: [
          catalogItem({ contentId: 'b1', status: 'on-pen-current', actionable: false }),
          catalogItem({ contentId: 'b2', filename: '0452.axb', friendlyName: 'Book Two', status: 'not-on-pen', sizeBytes: 300_000_000 }),
          catalogItem({ contentId: 'b3', filename: '0453.axb', friendlyName: 'Book Three', status: 'on-pen-differs', sizeBytes: 100_000_000 }),
        ],
      }),
    );

    await screen.findByText(/Your pen has 2 PonyABC book/);
    await screen.findByText(/1 new book and 1 update are available\. About \d+ minutes\./);
  });

  it('says everything is up to date, and disables the button, when there is nothing to do', async () => {
    await renderScreen(
      listResult({ penItems: [penItem({ contentId: 'b1' })], catalogItems: [catalogItem({ contentId: 'b1', status: 'on-pen-current', actionable: false })] }),
    );
    await screen.findByText(/All your books are up to date\./);
    expect((screen.getByRole('button', { name: 'Sync books' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows when the library was last checked', async () => {
    await renderScreen();
    expect(document.body.textContent).toMatch(/Last checked:/);
  });
});

describe('BookLibraryScreen — syncing', () => {
  const twoToDo = () =>
    listResult({
      penItems: [penItem({ contentId: 'b1' })],
      catalogItems: [
        catalogItem({ contentId: 'b1', status: 'on-pen-differs', sizeBytes: 100_000_000 }),
        catalogItem({ contentId: 'b2', filename: '0452.axb', friendlyName: 'Book Two', status: 'not-on-pen', sizeBytes: 20_000_000 }),
      ],
      meta: { fetchedAtMs: 1, source: 'live', offline: false, conflicts: [], lastCheck: okLastCheck, penFreeBytes: 9_000_000_000 },
    });

  it('adds the missing book and updates the changed one, smallest first', async () => {
    await renderScreen(twoToDo());
    fireEvent.click(screen.getByRole('button', { name: 'Sync books' }));

    await waitFor(() => expect(window.ponyabc.bookAdd).toHaveBeenCalled());
    await waitFor(() => expect(window.ponyabc.bookUpdate).toHaveBeenCalled());
    // The 20 MB addition runs before the 100 MB update.
    expect((window.ponyabc.bookAdd as ReturnType<typeof vi.fn>).mock.calls[0][0].contentId).toBe('b2');
  });

  it('tells the parent to restart the pen once a book has been added', async () => {
    await renderScreen(twoToDo());
    window.ponyabc.bookBatchEnd = vi.fn(async () => ({ status: 'reset', deleted: ['1.BIN'], ejected: false }));

    fireEvent.click(screen.getByRole('button', { name: 'Sync books' }));

    await screen.findByText('All done!');
    await screen.findByText(/Please unplug your pen, then switch it off and on again/);
  });

  it('stops cleanly when the pen fills up, keeping what finished', async () => {
    await renderScreen(twoToDo());
    window.ponyabc.bookAdd = vi.fn(async () => ({ status: 'no-space' }));

    fireEvent.click(screen.getByRole('button', { name: 'Sync books' }));

    await screen.findByText('Your pen filled up, so we stopped. The books that finished are on your pen.');
    // It stopped rather than carrying on to the next book.
    expect(window.ponyabc.bookUpdate).not.toHaveBeenCalled();
  });
});

/**
 * Owner decision, 2026-09-30. Any sync that wrote a book — added or replaced — ends by throwing
 * the pen's book list away, and says so. A sync that wrote nothing leaves the pen alone.
 *
 * The cost of getting this wrong is not cosmetic: the list is positional and carries no
 * filenames, so a stale one makes the pen read the WRONG book aloud with nothing visibly broken.
 */
describe('BookLibraryScreen — rebuilding the pen\'s book list', () => {
  const updateOnly = () =>
    listResult({
      penItems: [penItem({ contentId: 'b1' })],
      catalogItems: [catalogItem({ contentId: 'b1', status: 'on-pen-differs', sizeBytes: 100_000_000 })],
      meta: { fetchedAtMs: 1, source: 'live', offline: false, conflicts: [], lastCheck: okLastCheck, penFreeBytes: 9_000_000_000 },
    });

  const addOnly = () =>
    listResult({
      penItems: [],
      catalogItems: [catalogItem({ contentId: 'b2', filename: '0452.axb', status: 'not-on-pen', sizeBytes: 20_000_000 })],
      meta: { fetchedAtMs: 1, source: 'live', offline: false, conflicts: [], lastCheck: okLastCheck, penFreeBytes: 9_000_000_000 },
    });

  /** One book to add (20 MB) and one to update (100 MB): the addition runs first. */
  const oneOfEach = () =>
    listResult({
      penItems: [penItem({ contentId: 'b1' })],
      catalogItems: [
        catalogItem({ contentId: 'b1', status: 'on-pen-differs', sizeBytes: 100_000_000 }),
        catalogItem({ contentId: 'b2', filename: '0452.axb', friendlyName: 'Book Two', status: 'not-on-pen', sizeBytes: 20_000_000 }),
      ],
      meta: { fetchedAtMs: 1, source: 'live', offline: false, conflicts: [], lastCheck: okLastCheck, penFreeBytes: 9_000_000_000 },
    });

  const nothingToDo = () =>
    listResult({
      penItems: [penItem({ contentId: 'b1' })],
      catalogItems: [catalogItem({ contentId: 'b1', status: 'on-pen-current', actionable: false })],
      meta: { fetchedAtMs: 1, source: 'live', offline: false, conflicts: [], lastCheck: okLastCheck, penFreeBytes: 9_000_000_000 },
    });

  // The screen no longer commits the reset itself: it closes the batch, and the main process
  // decides. `bookBatchEnd`'s answer is what tells the screen whether to ask for the restart.
  const commitMock = () => window.ponyabc.bookBatchEnd as ReturnType<typeof vi.fn>;

  it('resets after a sync that only UPDATED a book, and asks for a restart', async () => {
    await renderScreen(updateOnly());
    window.ponyabc.bookBatchEnd = vi.fn(async () => ({ status: 'reset', deleted: ['1.BIN', 'BOOKFILE.BIN'], ejected: false }));

    fireEvent.click(screen.getByRole('button', { name: 'Sync books' }));

    await waitFor(() => expect(window.ponyabc.bookUpdate).toHaveBeenCalled());
    await waitFor(() => expect(commitMock()).toHaveBeenCalledTimes(1));
    await screen.findByText('All done!');
    await screen.findByText(/Please unplug your pen, then switch it off and on again/);
    expect(window.ponyabc.bookAdd).not.toHaveBeenCalled();
  });

  it('never tells a parent that an update needs no restart', async () => {
    await renderScreen(updateOnly());
    window.ponyabc.bookBatchEnd = vi.fn(async () => ({ status: 'reset', deleted: ['1.BIN'], ejected: false }));

    fireEvent.click(screen.getByRole('button', { name: 'Sync books' }));

    await screen.findByText('All done!');
    expect(screen.queryByText(/Your book has been updated/)).toBeNull();
  });

  it('resets after a sync that ADDED a book', async () => {
    await renderScreen(addOnly());
    window.ponyabc.bookBatchEnd = vi.fn(async () => ({ status: 'reset', deleted: ['1.BIN'], ejected: false }));

    fireEvent.click(screen.getByRole('button', { name: 'Sync books' }));

    await waitFor(() => expect(commitMock()).toHaveBeenCalledTimes(1));
    await screen.findByText('All done!');
  });

  it('leaves the pen alone when there was nothing to sync', async () => {
    await renderScreen(nothingToDo());

    // The button is disabled with nothing to do; clicking it must stay a no-op either way.
    fireEvent.click(screen.getByRole('button', { name: 'Sync books' }));

    await waitFor(() => expect(window.ponyabc.bookAdd).not.toHaveBeenCalled());
    expect(window.ponyabc.bookUpdate).not.toHaveBeenCalled();
    expect(window.ponyabc.bookRemove).not.toHaveBeenCalled();
    expect(screen.queryByText('All done!')).toBeNull();
    expect(screen.queryByText(/Please unplug your pen/)).toBeNull();
  });

  it('resets when the card filled up AFTER one book had been written', async () => {
    await renderScreen(oneOfEach());
    window.ponyabc.bookBatchEnd = vi.fn(async () => ({ status: 'reset', deleted: ['1.BIN'], ejected: false }));
    // The 20 MB addition goes first and succeeds; the 100 MB update then runs out of room.
    window.ponyabc.bookUpdate = vi.fn(async () => ({ status: 'no-space' }));

    fireEvent.click(screen.getByRole('button', { name: 'Sync books' }));

    await screen.findByText('Your pen filled up, so we stopped. The books that finished are on your pen.');
    await waitFor(() => expect(commitMock()).toHaveBeenCalledTimes(1));
    await screen.findByText('All done!');
  });

  it('leaves the pen alone when the very first write failed', async () => {
    await renderScreen(oneOfEach());
    // Nothing was written, so the main process has nothing pending and answers 'not-needed' —
    // the default mock. The batch is still closed, because a batch left open would make the
    // next single write reset nothing.
    window.ponyabc.bookAdd = vi.fn(async () => ({ status: 'no-space' }));

    fireEvent.click(screen.getByRole('button', { name: 'Sync books' }));

    await screen.findByText('Your pen filled up, so we stopped. The books that finished are on your pen.');
    await waitFor(() => expect(commitMock()).toHaveBeenCalledTimes(1));
    expect(screen.queryByText('All done!')).toBeNull();
    expect(screen.queryByText(/Please unplug your pen/)).toBeNull();
  });

  it('names the books it wrote, so the tidy-up only touches those', async () => {
    await renderScreen(addOnly());
    window.ponyabc.bookBatchEnd = vi.fn(async () => ({ status: 'reset', deleted: ['1.BIN'], ejected: false }));

    fireEvent.click(screen.getByRole('button', { name: 'Sync books' }));

    await waitFor(() => expect(commitMock()).toHaveBeenCalledWith({ writtenFileNames: ['0452.axb'] }));
  });
});

describe('BookLibraryScreen — not enough space', () => {
  it('refuses to start, says how much more is needed, and offers the way out', async () => {
    await renderScreen(
      listResult({
        penItems: [],
        catalogItems: [catalogItem({ status: 'not-on-pen', sizeBytes: 1_000_000_000 })],
        meta: { fetchedAtMs: 1, source: 'live', offline: false, conflicts: [], lastCheck: okLastCheck, penFreeBytes: 500_000_000 },
      }),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Sync books' }));

    await screen.findByText("Your pen doesn't have enough space");
    // Rounded UP: a figure rounded down sends a parent to free exactly that much and be
    // refused a second time.
    await screen.findByText(/You need about \d+(\.\d)? (MB|GB) more\. Please back up your recordings/);
    expect(screen.getByRole('button', { name: 'Go to My Recordings' })).toBeTruthy();
    // Nothing was written.
    expect(window.ponyabc.bookAdd).not.toHaveBeenCalled();
  });

  it('refuses to start when the free space could not be checked, and writes nothing', async () => {
    await renderScreen(
      listResult({
        penItems: [],
        catalogItems: [catalogItem({ status: 'not-on-pen', sizeBytes: 1_000_000 })],
        meta: { fetchedAtMs: 1, source: 'live', offline: false, conflicts: [], lastCheck: okLastCheck, penFreeBytes: null, penTotalBytes: null, penClusterBytes: null },
      }),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Sync books' }));

    await screen.findByText("We couldn't check your pen's free space. Please unplug your pen, plug it in again and try again.");
    expect(window.ponyabc.bookAdd).not.toHaveBeenCalled();
    expect(window.ponyabc.bookUpdate).not.toHaveBeenCalled();
  });
});

describe('BookLibraryScreen — wording', () => {
  it('uses real plurals, never "(s)"', async () => {
    await renderScreen(
      listResult({
        penItems: [penItem({ contentId: 'b1' })],
        catalogItems: [
          catalogItem({ contentId: 'b1', status: 'on-pen-current', actionable: false }),
          catalogItem({ contentId: 'b2', filename: '0452.axb', friendlyName: 'Book Two', status: 'not-on-pen' }),
        ],
      }),
    );

    await screen.findByText(/Your pen has 1 PonyABC book\./);
    await screen.findByText(/1 new book are available|1 new book is available|1 new book/);
    expect(document.body.textContent).not.toContain('(s)');
  });

  it('pluralises properly once there is more than one', async () => {
    await renderScreen(
      listResult({
        penItems: [penItem({ contentId: 'b1' }), penItem({ fileName: '0452.axb', contentId: 'b2' })],
        catalogItems: [
          catalogItem({ contentId: 'b1', status: 'on-pen-current', actionable: false }),
          catalogItem({ contentId: 'b2', status: 'on-pen-current', actionable: false }),
          catalogItem({ contentId: 'b3', filename: '0453.axb', friendlyName: 'Three', status: 'not-on-pen' }),
          catalogItem({ contentId: 'b4', filename: '0454.axb', friendlyName: 'Four', status: 'not-on-pen' }),
        ],
      }),
    );
    await screen.findByText(/Your pen has 2 PonyABC books\./);
    await screen.findByText(/2 new books are available\./);
  });

  it('rounds sizes up to something a parent can act on', async () => {
    await renderScreen(
      listResult({
        penItems: [],
        catalogItems: [catalogItem({ status: 'not-on-pen', sizeBytes: 300_000_000 })],
        meta: { fetchedAtMs: 1, source: 'live', offline: false, conflicts: [], lastCheck: okLastCheck, penFreeBytes: 100_000_000, penTotalBytes: 16_000_000_000, penClusterBytes: 32_768 },
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Sync books' }));

    // A round number, rounded UP — never "397.3 MB".
    const body = await screen.findByText(/You need about \d+00 MB more|You need about \d\.\d GB more/);
    expect(body.textContent).not.toMatch(/\d\.\d MB/);
  });
});

describe('BookLibraryScreen — the book list', () => {
  it('lists what is on the pen, what will be added and updated, with no actions', async () => {
    await renderScreen(
      listResult({
        penItems: [penItem({ contentId: 'b1' }), penItem({ fileName: 'someone-elses.axb', contentId: null, friendlyName: null, friendlyNameI18n: null, status: 'unknown', removable: false })],
        catalogItems: [catalogItem({ contentId: 'b2', filename: '0452.axb', friendlyName: 'Book Two', status: 'not-on-pen' })],
      }),
    );

    const list = document.querySelector('details.book-list') as HTMLDetailsElement;
    list.open = true;
    expect(list.textContent).toContain('On your pen');
    expect(list.textContent).toContain('Will be added');
    expect(list.textContent).toContain('Will be updated');
    expect(list.textContent).toContain('Other books (not from PonyABC)');
    expect(list.textContent).toContain('This app never changes them.');
    // Nothing in the list is pressable.
    expect(list.querySelectorAll('button, input')).toHaveLength(0);
  });
});

describe('BookLibraryScreen — after a change', () => {
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
  it('never shows a parent a filename, a checksum or a drive letter in the main view', async () => {
    await renderScreen(
      listResult({ penItems: [penItem({ contentId: 'b1', status: 'matched-hash-unknown' })], catalogItems: [catalogItem({ contentId: 'b2', filename: '0452.axb', friendlyName: 'Book Two', status: 'not-on-pen' })] }),
    );
    // The collapsed list and Advanced details legitimately contain filenames; the main view
    // above them must not.
    const main = document.body.textContent?.split('See book list')[0] ?? '';
    expect(main).not.toMatch(/checksum|hash|SHA-?256|\.axb|C:\\/i);
  });

  it('tells the parent plainly when the check could not reach us', async () => {
    // No successful fetch ever, so there is no "Last checked" to wait for — the error line is
    // itself the loaded state here.
    window.ponyabc.bookList = vi.fn(async () =>
      listResult({ meta: { fetchedAtMs: null, source: 'none', offline: true, conflicts: [], lastCheck: { state: 'error', atMs: 1, httpStatus: null, itemCount: null, message: 'offline', durationMs: 1 }, penFreeBytes: null } }),
    );
    renderWithPen(true);
    await screen.findByText("We couldn't reach the PonyABC library. Check your internet connection and try again.");
  });
});

/**
 * The one destructive thing this app does. A parent must know, before pressing anything, that a
 * sync will take books off their pen — which books, and what it frees.
 */
describe('BookLibraryScreen — books coming off the pen', () => {
  const beingRemoved = () =>
    listResult({
      penItems: [penItem({ contentId: 'gone', fileName: '0451.axb', sizeBytes: 900_000_000 })],
      catalogItems: [
        catalogItem({
          contentId: 'gone',
          filename: '0451.axb',
          friendlyName: '汉语拼音卡',
          friendlyNameI18n: { en: 'Mandarin Pinyin Cards' },
          state: 'remove_from_pens',
          sizeBytes: 900_000_000,
          status: 'on-pen-current',
          actionable: true,
        }),
      ],
      meta: { fetchedAtMs: 1, source: 'live', offline: false, conflicts: [], lastCheck: okLastCheck, penFreeBytes: 9_000_000_000 },
    });

  it('names the books that will go, and what that frees, before anything is pressed', async () => {
    await renderScreen(beingRemoved());
    await screen.findByText('One book will be taken off your pen');
    await screen.findByText(/frees about 900 MB/);
    await screen.findByText('Mandarin Pinyin Cards');
    // Nothing has happened yet.
    expect(window.ponyabc.bookRemove).not.toHaveBeenCalled();
  });

  it('removes it as part of Sync books, before anything is written', async () => {
    await renderScreen(beingRemoved());
    window.ponyabc.bookBatchEnd = vi.fn(async () => ({ status: 'reset', deleted: ['1.BIN'], ejected: false }));

    fireEvent.click(screen.getByRole('button', { name: 'Sync books' }));

    await waitFor(() => expect(window.ponyabc.bookRemove).toHaveBeenCalled());
    expect((window.ponyabc.bookRemove as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatchObject({
      fileName: '0451.axb',
    });
    // A removal moves every later book in the pen's list, so the list is rebuilt and the
    // parent is asked to restart — exactly as after an addition.
    await screen.findByText('All done!');
  });

  it('says nothing about removals when there are none', async () => {
    await renderScreen(
      listResult({
        penItems: [penItem({ contentId: 'b1' })],
        catalogItems: [catalogItem({ contentId: 'b1', status: 'on-pen-current', actionable: false })],
        meta: { fetchedAtMs: 1, source: 'live', offline: false, conflicts: [], lastCheck: okLastCheck, penFreeBytes: 9_000_000_000 },
      }),
    );
    expect(screen.queryByText(/will be taken off your pen/)).toBeNull();
  });
});
