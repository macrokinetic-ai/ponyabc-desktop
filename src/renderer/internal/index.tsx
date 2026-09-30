import { useEffect, useState } from 'react';
import type { TechnicalLogEntry } from '@shared/types';

/**
 * The Internal build's own screens and controls.
 *
 * Deliberately in English only and deliberately plain: this is for the owner and whoever is
 * testing, not for a parent, so it is not translated into eight languages and it does not
 * pretend to be part of the product. `./stub.tsx` is what the Store build gets instead.
 */
export const INTERNAL_UI = true;

/** Always on screen, so nobody can mistake this build for the one customers have. */
export function InternalBanner() {
  return (
    <div
      style={{
        background: '#7b4b9a',
        color: '#fff',
        fontWeight: 800,
        fontSize: '0.8rem',
        letterSpacing: '0.02em',
        padding: '0.35rem 1rem',
        textAlign: 'center',
      }}
    >
      INTERNAL TEST BUILD — not for customers
    </div>
  );
}

/** Support only: point the vendor's flasher at an already-extracted package folder. */
export function FirmwareFolderPicker({
  onPick,
  busy,
  selected,
}: {
  onPick: () => void;
  busy: boolean;
  selected: { rootDir: string; looksValid: boolean; missingFiles: string[] } | null;
}) {
  // Behind a disclosure, as it always was: the official download is the path, and pointing the
  // vendor tool at a folder by hand is a thing you have to go and ask for.
  const [open, setOpen] = useState(false);
  return (
    <div className="note-box" style={{ marginTop: '1rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem' }}>
        <div>
          <b>Internal: choose a firmware folder</b>
          <p className="hint" style={{ margin: 0 }}>
            Points the vendor tool at an already-extracted package. Support use only.
          </p>
        </div>
        <button type="button" className="button" onClick={() => setOpen((v) => !v)}>
          {open ? 'Hide' : 'Show'}
        </button>
      </div>
      {!open ? null : (
        <>
      <button type="button" className="button" disabled={busy} onClick={onPick}>
        Choose folder…
      </button>
      {selected && (
        <div className="firmware-package-info">
          <p>Selected: {selected.rootDir}</p>
          {selected.looksValid ? (
            <p className="hint">This folder looks like a complete package.</p>
          ) : (
            <>
              <p className="error-text">This folder is missing files the upgrade needs. Nothing will be run.</p>
              <ul>
                {selected.missingFiles.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
        </>
      )}
    </div>
  );
}

/**
 * Testing mode: a local test-catalogue folder, and the server's tester channel.
 *
 * Both feed the ordinary sync code. Nothing here has its own copy of the sync rules, because a
 * test that takes a different path tests the path nobody ships.
 */
export function TestingModeSection() {
  const [mode, setMode] = useState<{
    enabled: boolean;
    testCatalogueFolder: string | null;
    testerKey: string | null;
  } | null>(null);
  const [keyDraft, setKeyDraft] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    void window.ponyabc.testingModeGet().then(setMode);
  }, []);

  async function update(patch: Record<string, unknown>) {
    const next = await window.ponyabc.testingModeSet(patch);
    setMode(next);
  }

  if (!mode) return null;

  return (
    <div className="settings-panel">
      <h2>Testing mode</h2>
      <p className="hint">Internal build only. Test content goes through the same sync code as real content.</p>

      <label style={{ display: 'flex', alignItems: 'center', gap: '.5rem', margin: '.6rem 0' }}>
        <input type="checkbox" checked={mode.enabled} onChange={(e) => void update({ enabled: e.target.checked })} />
        Testing mode on
      </label>

      <h3>Local test catalogue</h3>
      <p className="hint">
        A folder holding <code>manifest.json</code>, <code>.axb</code> files and firmware packages.
        Its books are merged with the live catalogue and marked as test items.
      </p>
      <p className="hint">{mode.testCatalogueFolder ?? 'No folder chosen.'}</p>
      <button
        type="button"
        className="button"
        onClick={async () => {
          const folder = await window.ponyabc.testingModeChooseFolder();
          if (folder) await update({ testCatalogueFolder: folder });
        }}
      >
        Choose folder…
      </button>

      <h3>Server tester channel</h3>
      <p className="hint">
        A key the server checks. With it, the catalogue also returns hidden items. Sent only by
        this build, and only while testing mode is on.
      </p>
      <input
        type="password"
        value={keyDraft}
        placeholder={mode.testerKey ? '•••••••• (saved)' : 'paste the tester key'}
        onChange={(e) => setKeyDraft(e.target.value)}
      />{' '}
      <button
        type="button"
        className="button"
        onClick={async () => {
          await update({ testerKey: keyDraft.trim() || null });
          setKeyDraft('');
          setMessage('Saved. It is sent only while testing mode is on.');
        }}
      >
        Save key
      </button>
      {message && <p className="hint">{message}</p>}
      <p className="hint">
        The server side of this ships with the web release after 4 October. Until then the key is
        stored and sent, and the server simply ignores it — the tester channel is not available
        yet.
      </p>
    </div>
  );
}

/**
 * The technical log — Internal build only.
 *
 * The owner asked to be able to watch the .BIN files being deleted without taking the SD card
 * out of the pen and looking at it. Every step the app takes is listed here as it happens, in
 * the order it happened, newest last.
 *
 * All of the wording lives in this file rather than in the shared locales, so the Store build
 * carries neither the panel nor a single line of it. That is checked against the built bundle
 * by scripts/check-store-build.mjs.
 */
export function TechnicalLogPanel() {
  const [entries, setEntries] = useState<TechnicalLogEntry[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    void window.ponyabc.technicalLogGet().then(setEntries);
    return window.ponyabc.onTechnicalLogEntry((entry) => setEntries((prev) => [...prev, entry].slice(-500)));
  }, []);

  // Built from the parts rather than toLocaleTimeString: the renderer formats dates through
  // @shared/dateFormat with the app's chosen locale, and this panel is neither a date nor
  // customer-facing — it is a stopwatch for whoever is watching a sync happen.
  const clockTime = (ms: number): string => {
    const d = new Date(ms);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  };

  const describe = (entry: TechnicalLogEntry): string => {
    switch (entry.kind) {
      case 'file-deleted':
        return `Deleted ${entry.detail}`;
      case 'file-written':
        return `Wrote ${entry.detail}${entry.sizeBytes ? ` (${Math.round(entry.sizeBytes / 1_000_000)} MB)` : ''}`;
      case 'index-reset-requested':
        return `Index reset requested (${entry.detail})`;
      case 'index-reset-done':
        return `Index reset done — ${entry.detail}`;
      case 'index-reset-failed':
        return `Index reset FAILED — ${entry.detail}`;
      case 'firmware-preflight':
        return `Firmware preflight: ${entry.detail}`;
      case 'firmware-step':
        return `Firmware: ${entry.detail}`;
      case 'recording-restored':
        return `Restored ${entry.detail}`;
      case 'recording-backed-up':
        return `Backed up ${entry.detail}`;
      default:
        return entry.detail;
    }
  };

  return (
    <details className="advanced-details" open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary>Technical log ({entries.length})</summary>
      <p className="hint">
        Every step this build took, as it happened. Internal build only — the Store build has no
        such panel.
      </p>
      <div className="pane__toolbar">
        <button
          type="button"
          className="button"
          onClick={() => void window.ponyabc.technicalLogClear().then(() => setEntries([]))}
        >
          Clear
        </button>
      </div>
      {entries.length === 0 ? (
        <p className="hint">Nothing yet. Sync a book, re-download one, or run a firmware update.</p>
      ) : (
        <ul className="recordings-list">
          {entries.map((entry, i) => (
            <li key={`${entry.atMs}-${i}`} className="recordings-list__row">
              <span className="recordings-list__name" style={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>
                {clockTime(entry.atMs)} {describe(entry)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}
