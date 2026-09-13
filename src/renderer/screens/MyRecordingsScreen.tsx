import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { CopyFailureReason, CopySummary, RecordingFile, RecordingsListResult } from '@shared/types';
import { PenRootBar } from '../components/PenRootBar';
import { usePenRoot } from '../state/PenRootContext';
import { useCopyProgress } from '../hooks/useCopyProgress';

const REASON_KEY: Record<CopyFailureReason, string> = {
  'not-found': 'reasonNotFound',
  permission: 'reasonPermission',
  'no-space': 'reasonNoSpace',
  'io-error': 'reasonIoError',
  disconnected: 'reasonDisconnected',
  'security-rejected': 'reasonSecurityRejected',
  other: 'reasonOther',
};

export function MyRecordingsScreen() {
  const { t } = useTranslation('recordings');
  const { result: penRootResult } = usePenRoot();
  const [listResult, setListResult] = useState<RecordingsListResult | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [copying, setCopying] = useState(false);
  const [summary, setSummary] = useState<CopySummary | null>(null);
  const [destinationError, setDestinationError] = useState<string | null>(null);
  const { progress, reset: resetProgress } = useCopyProgress();

  useEffect(() => {
    let cancelled = false;
    setSelected(new Set());
    setSummary(null);
    if (penRootResult.status === 'ok') {
      window.ponyabc.listDiyRecordings().then((res) => {
        if (!cancelled) setListResult(res);
      });
    } else {
      setListResult(null);
    }
    return () => {
      cancelled = true;
    };
  }, [penRootResult]);

  const files: RecordingFile[] = listResult?.status === 'ok' ? listResult.files : [];

  const allSelected = files.length > 0 && selected.size === files.length;

  function toggleFile(name: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelected(allSelected ? new Set() : new Set(files.map((f) => f.name)));
  }

  async function handleSave() {
    setDestinationError(null);
    setSummary(null);
    const dest = await window.ponyabc.chooseSaveDestination();
    if (dest.status === 'cancelled') return;
    if (dest.status === 'invalid-destination') {
      setDestinationError(t('destinationOnPen'));
      return;
    }
    if (dest.status !== 'ok') {
      setDestinationError(dest.status === 'no-pen-selected' ? t('noPenSelected') : 'error' in dest ? dest.message : 'Error');
      return;
    }

    resetProgress();
    setCopying(true);
    const result = await window.ponyabc.copyRecordings(Array.from(selected));
    setCopying(false);
    setSummary(result);
  }

  const failedWithLabels = useMemo(
    () => (summary?.failed ?? []).map((f) => ({ ...f, reasonLabel: t(REASON_KEY[f.reason]) })),
    [summary, t],
  );

  return (
    <div className="screen">
      <h1>{t('title')}</h1>
      <PenRootBar />

      {penRootResult.status !== 'ok' && <p className="hint">{t('noPenSelected')}</p>}

      {listResult?.status === 'invalid' && (
        <p className="error-text">{t('title')}: missing {listResult.missing.join(', ')}</p>
      )}
      {listResult?.status === 'device-disconnected' && <p className="error-text">{t('deviceDisconnected')}</p>}
      {listResult?.status === 'error' && <p className="error-text">{listResult.message}</p>}

      {listResult?.status === 'ok' && (
        <>
          {files.length === 0 ? (
            <p className="hint">{t('emptyState')}</p>
          ) : (
            <>
              <div className="recordings-toolbar">
                <label>
                  <input type="checkbox" checked={allSelected} onChange={toggleSelectAll} />
                  {t('selectAll')}
                </label>
                <span>{t('selectedCount', { count: selected.size })}</span>
                <button type="button" className="button button--primary" disabled={selected.size === 0 || copying} onClick={() => void handleSave()}>
                  {t('saveButton')}
                </button>
              </div>

              <ul className="recordings-list">
                {files.map((file) => (
                  <li key={file.name}>
                    <label>
                      <input type="checkbox" checked={selected.has(file.name)} onChange={() => toggleFile(file.name)} />
                      {file.name}
                      <span className="recordings-list__size">{Math.round(file.sizeBytes / 1024)} KB</span>
                    </label>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}

      {destinationError && <p className="error-text">{destinationError}</p>}

      {copying && progress && (
        <p className="hint">{t('copying', { current: progress.fileIndex + 1, total: progress.fileCount, fileName: progress.fileName })}</p>
      )}

      {summary && (
        <div className="copy-summary">
          <h2>{t('summaryTitle')}</h2>
          {summary.status === 'device-disconnected' && <p className="error-text">{t('deviceDisconnected')}</p>}
          <p>{t('summarySucceeded', { count: summary.succeeded.length })}</p>
          {summary.renamed.length > 0 && (
            <>
              <p>{t('summaryRenamed', { count: summary.renamed.length })}</p>
              <ul>
                {summary.renamed.map((r) => (
                  <li key={r.original}>{t('renamedDetail', { original: r.original, savedAs: r.savedAs })}</li>
                ))}
              </ul>
            </>
          )}
          {failedWithLabels.length > 0 && (
            <>
              <p>{t('summaryFailed', { count: failedWithLabels.length })}</p>
              <ul>
                {failedWithLabels.map((f) => (
                  <li key={f.file}>{t('failedDetail', { file: f.file, message: f.reasonLabel })}</li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}
