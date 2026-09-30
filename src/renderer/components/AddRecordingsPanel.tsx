import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ConflictDecision, TransferToPenPlan, TransferToPenSummary } from '@shared/types';
import { parseStickerNumber } from '@shared/stickerNumber';
import { useAudioPreview } from '../hooks/useAudioPreview';
import { useTransferProgress } from '../hooks/useCopyProgress';
import { AudioPreviewBar } from './AudioPreviewBar';
import { stickerName } from './backupLabel';

/**
 * Putting a teacher's own recordings onto a pen.
 *
 * This used to live inside "Advanced tools" as two file-manager panes with a folder on each side.
 * It is the thing teachers actually use the app for, so it is on the screen now, and it asks the
 * one question that matters: which recordings, and what happens to what is already there.
 *
 * The file names carry the meaning — a recording called `0451.mp3` belongs to sticker 0451 — so a
 * name that is not a sticker number is called out before anything is copied, not refused
 * silently afterwards. A recording that would land on a number the pen already has is marked as
 * a replacement, and both takes can be listened to first, because only the person who made them
 * can tell which is which.
 *
 * Sending the same set to a row of pens one after another is 0.3.18. It needs the pen-to-pen
 * state this panel deliberately does not keep — which pens have had which set — and guessing at
 * that now would be the wrong shape to build on.
 */
export function AddRecordingsPanel(props: { penReady: boolean; penIdentityKey: string; onCopied: () => void }) {
  const { penReady, penIdentityKey, onCopied } = props;
  const { t } = useTranslation('recordings');
  const { t: tCommon } = useTranslation('common');

  const [folder, setFolder] = useState<string | null>(null);
  const [chosen, setChosen] = useState<string[]>([]);
  const [rejected, setRejected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { progress, reset: resetProgress } = useTransferProgress();
  const preview = useAudioPreview();

  // Which of the chosen recordings are new and which would replace one is the main process's
  // answer, not this screen's guess: `planTransferToPen` is the same call the copy itself is
  // bound to, and it carries the pen connection the copy must still match.
  const [plan, setPlan] = useState<TransferToPenPlan | null>(null);

  const rows = chosen.map((fileName) => ({
    fileName,
    sticker: parseStickerNumber(fileName),
    replaces: plan ? plan.conflicts.some((c) => c.fileName === fileName) : false,
    planned: plan ? plan.toAdd.some((a) => a.fileName === fileName) || plan.conflicts.some((c) => c.fileName === fileName) : false,
  }));
  const usable = rows.filter((r) => r.sticker !== null && r.planned);

  const choose = useCallback(async () => {
    setError(null);
    setMessage(null);
    try {
      const result = await window.ponyabc.chooseRecordingFiles();
      if (result.status === 'cancelled') return;
      if (result.status === 'mixed-folders') {
        setError(t('addFromComputer.mixedFolders'));
        return;
      }
      if (result.status === 'invalid') {
        setError(tCommon('errors.generic', { message: result.reason }));
        return;
      }
      setFolder(result.folder);
      setChosen(result.fileNames);
      setRejected(result.rejected);
      await refreshPlan(result.fileNames);
    } catch (err) {
      setError(tCommon('errors.generic', { message: err instanceof Error ? err.message : String(err) }));
    }
  }, [t, tCommon]);

  const refreshPlan = useCallback(
    async (fileNames: string[]) => {
      if (fileNames.length === 0) {
        setPlan(null);
        return;
      }
      try {
        const result = await window.ponyabc.planTransferToPen(fileNames);
        if (result.status === 'ok') {
          setPlan(result);
          if (!result.hasEnoughSpace) setError(t('addFromComputer.noSpace'));
        } else {
          setPlan(null);
          setError(result.status === 'no-pen-selected' ? t('noPenSelected') : tCommon('errors.generic', { message: result.status }));
        }
      } catch (err) {
        setPlan(null);
        setError(tCommon('errors.generic', { message: err instanceof Error ? err.message : String(err) }));
      }
    },
    [t, tCommon],
  );

  useEffect(() => resetProgress, [resetProgress]);

  // A pen swap invalidates the plan entirely: which recordings clash, and the connection the copy
  // is bound to, both belong to the pen that was plugged in when it was made.
  useEffect(() => {
    if (chosen.length > 0) void refreshPlan(chosen);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [penIdentityKey]);

  async function copyToPen() {
    if (busy || usable.length === 0) return;
    setBusy(true);
    setMessage(null);
    setError(null);
    resetProgress();
    try {
      if (!plan) return;
      const fileNames = usable.map((r) => r.fileName);
      // Every replacement is an explicit decision: the write path refuses to overwrite anything
      // that has not been named here, whatever this screen asked for.
      const decisions: Record<string, ConflictDecision> = {};
      for (const row of usable) if (row.replaces) decisions[row.fileName] = 'replace';

      const summary: TransferToPenSummary = await window.ponyabc.executeTransferToPen({
        fileNames,
        decisions,
        penGeneration: plan.penGeneration,
      });

      if (summary.status === 'backup-failed') {
        setError(t('addFromComputer.backupFailed'));
        return;
      }
      if (summary.status !== 'completed') {
        setError(t(`transferStatus.${summary.status}`, { defaultValue: tCommon('errors.generic', { message: summary.status }) }));
        return;
      }
      setMessage(t('addFromComputer.done', { count: summary.added.length + summary.replaced.length }));
      setChosen([]);
      setPlan(null);
      onCopied();
    } catch (err) {
      setError(tCommon('errors.generic', { message: err instanceof Error ? err.message : String(err) }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="add-recordings">
      <h2>{t('addFromComputer.title')}</h2>
      <p className="hint">{t('addFromComputer.intro')}</p>

      <button type="button" className="button" disabled={busy} onClick={() => void choose()}>
        {t('addFromComputer.choose')}
      </button>
      {folder && <p className="hint">{t('addFromComputer.chosenFrom', { folder })}</p>}

      {rejected.length > 0 && <p className="hint">{t('addFromComputer.rejected', { names: rejected.map(stickerName).join(', ') })}</p>}

      {rows.length === 0 ? (
        <p className="hint">{t('addFromComputer.noneChosen')}</p>
      ) : (
        <ul className="recordings-list">
          {rows.map((row) => (
            <li key={row.fileName} className="recordings-list__row">
              <span className="recordings-list__label">
                <span className="recordings-list__name">{stickerName(row.fileName)}</span>
                {row.sticker === null ? (
                  <span className="error-text">{t('addFromComputer.badName')}</span>
                ) : row.replaces ? (
                  <span className="error-text">{t('addFromComputer.willReplace')}</span>
                ) : (
                  <span className="hint">{t('addFromComputer.willAdd')}</span>
                )}
              </span>
              <div className="recordings-list__detail-actions">
                <button type="button" className="button" onClick={() => void preview.play('computer', row.fileName)}>
                  {t('addFromComputer.previewChosen')}
                </button>
                {/* Only when there is something to compare it with. */}
                {row.replaces && (
                  <button type="button" className="button" onClick={() => void preview.play('pen', row.fileName)}>
                    {t('addFromComputer.previewPen')}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <AudioPreviewBar state={preview.state} onTogglePlayPause={preview.togglePlayPause} onSeek={preview.seek} onClose={preview.stop} />

      <p className="hint">{t('addFromComputer.backupFirst')}</p>

      <button
        type="button"
        className="button button--primary"
        disabled={busy || !penReady || usable.length === 0}
        onClick={() => void copyToPen()}
      >
        {busy ? t('addFromComputer.copying') : t('addFromComputer.copyButton')}
      </button>

      {busy && (
        <div className="note-box">
          <p className="hint">{t('addFromComputer.copying')}</p>
          <progress className="book-progress" value={progress?.fileIndex ?? 0} max={Math.max(progress?.fileCount ?? 1, 1)} />
          {progress?.fileName && <p className="hint">{stickerName(progress.fileName)}</p>}
        </div>
      )}

      {message && <p className="hint">{message}</p>}
      {error && <p className="error-text">{error}</p>}

      {/* Said out loud rather than left as a surprise: the obvious next thing a teacher will want
          is not here yet. */}
      <p className="hint">{t('addFromComputer.manyPens')}</p>
    </section>
  );
}
