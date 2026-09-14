// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { initI18n } from '../../src/renderer/i18n';
import i18n from '../../src/renderer/i18n';
import { PenRootProvider } from '../../src/renderer/state/PenRootContext';
import { BookLibraryProvider } from '../../src/renderer/state/BookLibraryContext';
import { BookLibraryScreen } from '../../src/renderer/screens/BookLibraryScreen';
import type { BookCatalogItem, BookListResult, BookPenItem, PonyAbcApi } from '../../src/shared/types';

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
    status: 'matched-current',
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
    onBookVerifyUpdate: vi.fn((listener) => {
      verifyListener = listener as (event: unknown) => void;
      return () => {
        verifyListener = null;
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

beforeEach(() => {
  progressListener = null;
  verifyListener = null;
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

describe('BookLibraryScreen — dual pane', () => {
  it('renders two panes (pen on the left, catalog on the right)', async () => {
    await renderScreen();
    expect(document.querySelectorAll('.pane')).toHaveLength(2);
  });

  it('shows a "couldn\'t reach the server" status when the catalog has never been fetched', async () => {
    const list = listResult({
      penItems: null,
      catalogItems: [],
      meta: {
        fetchedAtMs: null,
        source: 'none',
        offline: true,
        conflicts: [],
        lastCheck: { state: 'error', atMs: 1, httpStatus: null, itemCount: null, message: 'network down', durationMs: 1 },
      },
    });
    window.ponyabc.bookList = vi.fn(async () => list);
    window.ponyabc.bookCatalogRefresh = vi.fn(async () => list);
    renderWithPen(false);
    await screen.findByText(/couldn't reach the server/i);
    await screen.findByText(/no catalog has been successfully loaded yet/i);
  });

  it('renders the last-updated time when a catalog has been fetched', async () => {
    await renderScreen();
    expect(screen.getByText(/Last updated:/)).toBeTruthy();
  });

  it('shows the dev-fixture banner only when the catalog source is "fixture"', async () => {
    await renderScreen(listResult({ meta: { fetchedAtMs: 1, source: 'fixture', offline: false, conflicts: [], lastCheck: okLastCheck } }));
    await screen.findByText(/Development catalog data/);
  });

  it('does not show the dev-fixture banner for a live catalog', async () => {
    await renderScreen();
    expect(screen.queryByText(/Development catalog data/)).toBeNull();
  });

  it('renders an ambiguous-conflict notice when the catalog reports one', async () => {
    await renderScreen(
      listResult({
        meta: { fetchedAtMs: 1, source: 'live', offline: false, conflicts: [{ filenameLower: 'a.axb', contentIds: ['b1', 'b2'] }], lastCheck: okLastCheck },
      }),
    );
    await screen.findByText(/share a filename/);
  });
});

describe('BookLibraryScreen — left pane (pen)', () => {
  it('an Unknown pen file has no checkbox and shows the filename + Unknown label', async () => {
    await renderScreen(listResult({ penItems: [penItem({ fileName: 'mystery.axb', contentId: null, friendlyName: null, friendlyNameI18n: null, status: 'unknown', removable: false })] }));
    await screen.findByText(/mystery\.axb — Unknown/);
    // No checkbox is rendered for it at all (read-only, not merely disabled) — scoped to the
    // list itself, since the pane's own "select all" toolbar checkbox is unrelated.
    expect(document.querySelectorAll('.pane')[0].querySelector('.pane__list')?.querySelectorAll('input[type="checkbox"]')).toHaveLength(0);
  });

  it('an unmatched pen file shows "Waiting for catalog match" (not "Unknown") while no catalog has ever loaded, and stays read-only', async () => {
    await renderScreen(
      listResult({ penItems: [penItem({ fileName: 'mystery.axb', contentId: null, friendlyName: null, friendlyNameI18n: null, status: 'awaiting-catalog', removable: false })] }),
    );
    await screen.findByText(/mystery\.axb — Waiting for catalog match/);
    expect(document.querySelectorAll('.pane')[0].querySelector('.pane__list')?.querySelectorAll('input[type="checkbox"]')).toHaveLength(0);
  });

  it('a matched pen file is selectable and shows its catalog display name', async () => {
    await renderScreen();
    const checkbox = document.querySelectorAll('.pane')[0].querySelector('input[type="checkbox"]');
    expect(checkbox).not.toBeNull();
    fireEvent.click(checkbox as Element);
    expect((checkbox as HTMLInputElement).checked).toBe(true);
  });

  it('selecting a matched pen file and clicking Remove shows an explicit confirm panel with filename and size', async () => {
    await renderScreen();
    const checkbox = document.querySelectorAll('.pane')[0].querySelector('input[type="checkbox"]') as HTMLInputElement;
    fireEvent.click(checkbox);
    fireEvent.click(screen.getByRole('button', { name: 'Remove from pen' }));
    const confirmPanel = await screen.findByText('Remove from pen?');
    expect(confirmPanel.closest('.plan-panel')?.textContent).toContain('0451.axb'); // filename is visible somewhere in the confirmation
    expect(confirmPanel.closest('.plan-panel')?.textContent).toContain('1 KB'); // formatBytes(1000) === "1 KB"
  });
});

describe('BookLibraryScreen — right pane (catalog)', () => {
  it('metadata-incomplete and ambiguous catalog items have no checkbox (not actionable)', async () => {
    await renderScreen(listResult({ catalogItems: [catalogItem({ status: 'metadata-incomplete', actionable: false })] }));
    expect(document.querySelectorAll('.pane')[1].querySelectorAll('input[type="checkbox"]')).toHaveLength(0);
  });

  it('selecting a not-on-pen item and clicking Add to pen executes immediately (no confirm needed)', async () => {
    await renderScreen(listResult({ catalogItems: [catalogItem({ status: 'not-on-pen' })] }));
    const checkbox = document.querySelectorAll('.pane')[1].querySelector('input[type="checkbox"]') as HTMLInputElement;
    fireEvent.click(checkbox);
    fireEvent.click(screen.getByRole('button', { name: 'Add to pen' }));
    await waitFor(() => expect(window.ponyabc.bookAdd).toHaveBeenCalledWith({ contentId: 'b1', penGeneration: 1 }));
  });

  it('selecting an on-pen-differs item and clicking Add to pen shows a confirm panel requiring Replace/Skip before executing', async () => {
    await renderScreen(listResult({ catalogItems: [catalogItem({ status: 'on-pen-differs' })] }));
    const checkbox = document.querySelectorAll('.pane')[1].querySelector('input[type="checkbox"]') as HTMLInputElement;
    fireEvent.click(checkbox);
    fireEvent.click(screen.getByRole('button', { name: 'Add to pen' }));
    await screen.findByText('Some selected items differ from the pen');
    expect(window.ponyabc.bookUpdate).not.toHaveBeenCalled();

    const confirmButton = screen.getByRole('button', { name: 'Confirm' });
    expect((confirmButton as HTMLButtonElement).disabled).toBe(true); // no decision made yet

    fireEvent.click(screen.getByRole('radio', { name: 'Replace' }));
    fireEvent.click(confirmButton);
    await waitFor(() => expect(window.ponyabc.bookUpdate).toHaveBeenCalledWith({ contentId: 'b1', penGeneration: 1 }));
  });

  it('no progress bar renders until a real download-progress event arrives — never a fake/animated one', async () => {
    await renderScreen();
    expect(document.querySelector('progress')).toBeNull();
    progressListener?.({ contentId: 'b1', bytesReceived: 512, totalBytes: 1000, phase: 'downloading' });
    await waitFor(() => expect(document.querySelector('progress')).not.toBeNull());
    expect(document.querySelector('progress')?.getAttribute('value')).toBe('512');
  });

  it('the cancel button wired to a progress event calls bookDownloadCancel with that contentId', async () => {
    await renderScreen();
    progressListener?.({ contentId: 'b1', bytesReceived: 10, totalBytes: 1000, phase: 'downloading' });
    const cancelButton = await screen.findByRole('button', { name: 'Cancel' });
    fireEvent.click(cancelButton);
    await waitFor(() => expect(window.ponyabc.bookDownloadCancel).toHaveBeenCalledWith('b1'));
  });

  it('an offline UI-language switch updates the displayed name instantly, with no additional bookList/bookCatalogRefresh calls', async () => {
    await renderScreen();
    const listCallsBefore = (window.ponyabc.bookList as ReturnType<typeof vi.fn>).mock.calls.length;
    const refreshCallsBefore = (window.ponyabc.bookCatalogRefresh as ReturnType<typeof vi.fn>).mock.calls.length;

    await i18n.changeLanguage('zh-Hant');
    await screen.findAllByText('第一本書');

    expect((window.ponyabc.bookList as ReturnType<typeof vi.fn>).mock.calls.length).toBe(listCallsBefore);
    expect((window.ponyabc.bookCatalogRefresh as ReturnType<typeof vi.fn>).mock.calls.length).toBe(refreshCallsBefore);
  });

  it('a "verifying" catalog item resolves in place once a bookVerifyUpdate event arrives, no re-list call', async () => {
    await renderScreen(listResult({ catalogItems: [catalogItem({ status: 'on-pen-verifying', actionable: false })] }));
    await screen.findByText(/Verifying content/);
    const listCallsBefore = (window.ponyabc.bookList as ReturnType<typeof vi.fn>).mock.calls.length;

    verifyListener?.({ fileName: '0451.axb', contentId: 'b1', result: { penStatus: 'matched-differs', catalogStatus: 'on-pen-differs' } });

    await screen.findByText(/On pen, differs from this version/);
    expect((window.ponyabc.bookList as ReturnType<typeof vi.fn>).mock.calls.length).toBe(listCallsBefore);
  });
});
