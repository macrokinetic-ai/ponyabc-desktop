// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { initI18n } from '../../src/renderer/i18n';
import i18n from '../../src/renderer/i18n';
import { PenRootProvider } from '../../src/renderer/state/PenRootContext';
import { BookLibraryProvider } from '../../src/renderer/state/BookLibraryContext';
import { BookLibraryScreen } from '../../src/renderer/screens/BookLibraryScreen';
import type { BookLibraryItem, BookListResult, PonyAbcApi } from '../../src/shared/types';

function item(overrides: Partial<BookLibraryItem> = {}): BookLibraryItem {
  return {
    contentId: 'b1',
    filename: '0451.axb',
    friendlyName: 'Book One',
    friendlyNameI18n: { en: 'Book One', 'zh-Hant': '第一本書' },
    status: 'catalog-not-cached',
    sizeBytes: 1000,
    cached: false,
    onPen: false,
    availableActions: ['add'],
    ...overrides,
  };
}

function listResult(overrides: Partial<BookListResult> = {}, itemsOverride?: BookLibraryItem[]): BookListResult {
  return {
    status: 'ok',
    items: itemsOverride ?? [item()],
    meta: { fetchedAtMs: 1_700_000_000_000, source: 'live', offline: false, conflicts: [] },
    ...overrides,
  };
}

let progressListener: ((event: unknown) => void) | null = null;

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
  // @ts-expect-error — test-only global shim for the preload bridge
  window.ponyabc = mockPonyAbc();
});

afterEach(() => {
  cleanup();
  void i18n.changeLanguage('en');
});

async function renderScreen() {
  render(
    <PenRootProvider>
      <BookLibraryProvider>
        <BookLibraryScreen />
      </BookLibraryProvider>
    </PenRootProvider>,
  );
  await screen.findByText('Book One');
}

describe('BookLibraryScreen', () => {
  it('shows the offline/unavailable banner when the catalog has never been fetched', async () => {
    window.ponyabc.bookList = vi.fn(async () => listResult({ meta: { fetchedAtMs: null, source: 'none', offline: true, conflicts: [] } }, []));
    window.ponyabc.bookCatalogRefresh = vi.fn(async () => listResult({ meta: { fetchedAtMs: null, source: 'none', offline: true, conflicts: [] } }, []));
    render(
      <PenRootProvider>
        <BookLibraryProvider>
          <BookLibraryScreen />
        </BookLibraryProvider>
      </PenRootProvider>,
    );
    await screen.findByText(/could not be reached/i);
  });

  it('renders the last-updated time when a catalog has been fetched', async () => {
    await renderScreen();
    expect(screen.getByText(/Last updated:/)).toBeTruthy();
  });

  it('shows the dev-fixture banner only when the catalog source is "fixture"', async () => {
    window.ponyabc.bookList = vi.fn(async () => listResult({ meta: { fetchedAtMs: 1, source: 'fixture', offline: false, conflicts: [] } }));
    window.ponyabc.bookCatalogRefresh = vi.fn(async () => listResult({ meta: { fetchedAtMs: 1, source: 'fixture', offline: false, conflicts: [] } }));
    render(
      <PenRootProvider>
        <BookLibraryProvider>
          <BookLibraryScreen />
        </BookLibraryProvider>
      </PenRootProvider>,
    );
    await screen.findByText(/Development catalog data/);
  });

  it('does not show the dev-fixture banner for a live catalog', async () => {
    await renderScreen();
    expect(screen.queryByText(/Development catalog data/)).toBeNull();
  });

  it('renders an ambiguous-conflict notice when the catalog reports one', async () => {
    window.ponyabc.bookList = vi.fn(async () =>
      listResult({ meta: { fetchedAtMs: 1, source: 'live', offline: false, conflicts: [{ filenameLower: 'a.axb', contentIds: ['b1', 'b2'] }] } }),
    );
    window.ponyabc.bookCatalogRefresh = window.ponyabc.bookList;
    render(
      <PenRootProvider>
        <BookLibraryProvider>
          <BookLibraryScreen />
        </BookLibraryProvider>
      </PenRootProvider>,
    );
    await screen.findByText(/share a filename/);
  });

  it('a metadata-incomplete item shows no install action', async () => {
    window.ponyabc.bookList = vi.fn(async () => listResult({}, [item({ status: 'catalog-incomplete-metadata', availableActions: [] })]));
    window.ponyabc.bookCatalogRefresh = window.ponyabc.bookList;
    await renderScreen();
    expect(screen.queryByRole('button', { name: 'Add to pen' })).toBeNull();
  });

  it('no progress bar renders until a real download-progress event arrives — never a fake/animated one', async () => {
    await renderScreen();
    expect(document.querySelector('progress')).toBeNull();

    fireEvent(window, new Event('noop')); // no-op, just to ensure act() isn't needed for the next state update
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
    await screen.findByText('第一本書');

    expect((window.ponyabc.bookList as ReturnType<typeof vi.fn>).mock.calls.length).toBe(listCallsBefore);
    expect((window.ponyabc.bookCatalogRefresh as ReturnType<typeof vi.fn>).mock.calls.length).toBe(refreshCallsBefore);
  });
});
