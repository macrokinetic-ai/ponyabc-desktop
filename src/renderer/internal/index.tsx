import { useEffect, useState } from 'react';

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
