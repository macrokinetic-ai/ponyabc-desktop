import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { RecordingsListResult } from '@shared/types';
import type { RestoreDecision, RestorePlan } from '../../main/services/recordingRestore';
import type { SnapshotContents, SnapshotSummary } from '../../main/ipc/recordingBackup';
import { useAudioPreview } from '../hooks/useAudioPreview';
import { AudioPreviewBar } from './AudioPreviewBar';
import { formatDateTimeMedium } from '@shared/dateFormat';
import { backupLabel, formatSize, stickerName } from './backupLabel';

/**
 * Recordings, for the person who made them.
 *
 * Two lists and two verbs: what is on the pen, and the backups on this computer. Everything a
 * parent is likely to want — keep a copy, put one back, give it a name, move it to a different
 * sticker, delete one — is reachable from here without meeting a filename.
 *
 * The one place we deliberately stop and ask is a restore that would overwrite a different
 * recording of the same number. Both takes are offered for listening, because only the person
 * who recorded them can tell which is which.
 */

function formatWhen(ms: number, locale: string): string {
  return formatDateTimeMedium(locale, ms);
}

export function RecordingBackupsPanel() {
  const { t, i18n } = useTranslation('recordings');
  const { t: tCommon } = useTranslation('common');

  const [penFiles, setPenFiles] = useState<RecordingsListResult | null>(null);
  const [backups, setBackups] = useState<SnapshotSummary[]>([]);
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [selectedBackupId, setSelectedBackupId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  /** What is inside the chosen backup, and which of those the person wants back. rc5 never
   *  fetched this, so a backup could say "20 recordings" above an empty panel. */
  const [contents, setContents] = useState<SnapshotContents | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  /** Separate from `busy`: the backup button must go dead the instant it is pressed, before
   *  any await, so a quick double click cannot make two backups. */
  const [backingUp, setBackingUp] = useState(false);
  const [restoring, setRestoring] = useState(false);
  /** Which recording is being copied, for both backing up and putting back. The main process has
   *  always sent this and nothing was listening, so a backup of twenty recordings showed one
   *  unchanging line for however long it took. */
  const [step, setStep] = useState<{ fileIndex: number; fileCount: number; fileName: string } | null>(null);

  const [plan, setPlan] = useState<RestorePlan | null>(null);
  const [decisions, setDecisions] = useState<Record<string, RestoreDecision>>({});
  const [editingLabel, setEditingLabel] = useState<string | null>(null);
  const [labelDraft, setLabelDraft] = useState('');
  const [reassigning, setReassigning] = useState<string | null>(null);
  const [reassignInput, setReassignInput] = useState('');
  const [reassignError, setReassignError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const preview = useAudioPreview();

  const refresh = useCallback(async () => {
    // One failing call must not leave the whole panel blank — a parent who cannot see their
    // recordings has no way to tell "nothing there" from "something went wrong".
    try {
      const [pen, list, labelMap] = await Promise.all([
        window.ponyabc.listDiyRecordings(),
        window.ponyabc.recordingBackupList(),
        window.ponyabc.recordingLabelsGet(),
      ]);
      setPenFiles(pen);
      setBackups(list);
      setLabels(labelMap);
      setSelectedBackupId((current) => current ?? list[0]?.snapshotId ?? null);
    } catch (err) {
      setMessage(tCommon('errors.generic', { message: err instanceof Error ? err.message : String(err) }));
    }
  }, [tCommon]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => window.ponyabc.onRecordingBackupProgress(setStep), []);

  // The chosen backup's contents, refetched when the choice changes. Everything in it starts
  // ticked: putting a whole backup back is the common case, and a list that starts empty makes
  // the primary button look broken.
  useEffect(() => {
    if (!selectedBackupId) {
      setContents(null);
      setChosen(new Set());
      return;
    }
    let cancelled = false;
    setContents(null);
    void window.ponyabc
      .recordingBackupContents({ snapshotId: selectedBackupId })
      .then((result) => {
        if (cancelled) return;
        setContents(result);
        setChosen(result.status === 'ok' ? new Set(result.entries.map((e) => e.fileName)) : new Set());
      })
      .catch(() => {
        if (!cancelled) setContents({ status: 'no-such-backup' });
      });
    return () => {
      cancelled = true;
    };
  }, [selectedBackupId]);

  const penList = penFiles?.status === 'ok' ? penFiles.files : [];
  const penReady = penFiles?.status === 'ok';
  const nameOf = (fileName: string) => labels[fileName] ?? fileName.replace(/\.mp3$/i, '');

  async function run<T>(action: () => Promise<T>, onDone?: (result: T) => void) {
    setBusy(true);
    setMessage(null);
    setStep(null);
    try {
      const result = await action();
      onDone?.(result);
      await refresh();
    } catch (err) {
      setMessage(tCommon('errors.generic', { message: err instanceof Error ? err.message : String(err) }));
    } finally {
      setStep(null);
      setBusy(false);
    }
  }

  async function backUpNow() {
    if (backingUp) return;
    setBackingUp(true);
    try {
      await run(
        () => window.ponyabc.recordingBackupCreate(),
        (result) => {
          if (result.status === 'no-pen-selected') setMessage(t('noPenSelected'));
          else setMessage(t('backup.done', { count: result.recordingCount }));
        },
      );
    } finally {
      setBackingUp(false);
    }
  }

  const startRestore = () =>
    selectedBackupId &&
    run(
      () => window.ponyabc.recordingRestorePlan({ snapshotId: selectedBackupId, fileNames: [...chosen] }),
      (result) => {
        if (result.status !== 'ok') {
          setMessage(result.status === 'no-pen-selected' ? t('noPenSelected') : t('backup.missing'));
          return;
        }
        // Nothing to ask and nothing to do: everything in this backup is already on the pen.
        if (result.items.every((i) => i.state === 'identical')) {
          setMessage(t('restore.nothingToDo'));
          return;
        }
        setPlan(result);
        setDecisions({});
      },
    );

  const confirmRestore = () =>
    plan &&
    selectedBackupId &&
    runRestore(
      () => window.ponyabc.recordingRestoreExecute({ snapshotId: selectedBackupId, plan, decisions }),
      (result) => {
        setPlan(null);
        if (result.status !== 'ok') {
          setMessage(result.status === 'no-pen-selected' ? t('noPenSelected') : t('backup.missing'));
          return;
        }
        setMessage(t('restore.done', { count: result.restored.length + result.replaced.length }));
      },
    );

  /** As `run`, plus the flag the "Put them back" button reads while it works. */
  async function runRestore<T>(action: () => Promise<T>, onDone?: (result: T) => void) {
    setRestoring(true);
    try {
      await run(action, onDone);
    } finally {
      setRestoring(false);
    }
  }

  const saveLabel = (fileName: string) =>
    run(
      () => window.ponyabc.recordingLabelSet({ fileName, label: labelDraft }),
      () => setEditingLabel(null),
    );

  const doReassign = (fileName: string) =>
    run(
      () => window.ponyabc.recordingReassign({ fileName, input: reassignInput }),
      (result) => {
        if (result.status === 'ok') {
          setReassigning(null);
          setReassignError(null);
          setMessage(t('reassign.done'));
          return;
        }
        setReassignError(
          result.status === 'rejected'
            ? t(`reassign.rejected.${result.reason === 'not-digits' ? 'notDigits' : result.reason === 'invalid-length' ? 'length' : result.reason === 'occupied' ? 'occupied' : 'unchanged'}`)
            : t('reassign.failed'),
        );
      },
    );

  const doDelete = (fileName: string) =>
    run(
      () => window.ponyabc.recordingDeleteFromPen({ fileNames: [fileName] }),
      (result) => {
        setConfirmDelete(null);
        setMessage(result.status === 'ok' ? t('deletePen.done') : t('deletePen.failed'));
      },
    );

  const clashes = plan?.items.filter((i) => i.state === 'clash') ?? [];
  const allDecided = clashes.every((i) => decisions[i.fileName]);

  return (
    <div className="recordings-v2">
      <div className="dual-pane">
        <section className="pane">
          <div className="pane__header">
            <h2>{t('onPen.title')}</h2>
            <p className="hint">{t('onPen.intro')}</p>
            {/* Single-shot: `backingUp` is set before the first await, so the second half of a
                double click finds the button already disabled and makes no second backup. */}
            <button
              type="button"
              className="button button--primary"
              disabled={busy || backingUp || !penReady}
              onClick={() => void backUpNow()}
            >
              {backingUp ? t('backup.working') : t('backup.button')}
            </button>
            {step && (
              <div>
                <progress className="book-progress" value={step.fileIndex} max={Math.max(step.fileCount, 1)} />
                <p className="hint">
                  {t('backup.progress', {
                    done: step.fileIndex + 1,
                    total: step.fileCount,
                    name: nameOf(step.fileName),
                  })}
                </p>
              </div>
            )}
          </div>
          <div className="pane__list">
            {!penReady && <p className="hint">{t('noPenSelected')}</p>}
            {penReady && penList.length === 0 && <p className="hint">{t('emptyState')}</p>}
            <ul className="recordings-list">
              {penList.map((file) => (
                <li key={file.name} className="recordings-list__row">
                  <span className="recordings-list__label">
                    <span className="recordings-list__name">{nameOf(file.name)}</span>
                  </span>
                  <div className="recordings-list__detail-actions">
                    <button
                      type="button"
                      className="button"
                      onClick={() =>
                        preview.state?.source === 'pen' && preview.state.fileName === file.name
                          ? preview.stop()
                          : void preview.play('pen', file.name)
                      }
                    >
                      {t('actions.play')}
                    </button>
                    <button type="button" className="button" disabled={busy} onClick={() => { setEditingLabel(file.name); setLabelDraft(labels[file.name] ?? ''); }}>
                      {t('label.button')}
                    </button>
                    <button type="button" className="button" disabled={busy} onClick={() => { setReassigning(file.name); setReassignInput(''); setReassignError(null); }}>
                      {t('reassign.button')}
                    </button>
                    <button type="button" className="button" disabled={busy} onClick={() => setConfirmDelete(file.name)}>
                      {t('actions.deleteFromPen')}
                    </button>
                  </div>

                  {editingLabel === file.name && (
                    <div className="recordings-list__detail">
                      <label>
                        {t('label.prompt')}
                        <input type="text" value={labelDraft} onChange={(e) => setLabelDraft(e.target.value)} />
                      </label>
                      <p className="hint">{t('label.hint')}</p>
                      <div className="recordings-list__detail-actions">
                        <button type="button" className="button button--primary" disabled={busy} onClick={() => void saveLabel(file.name)}>
                          {tCommon('buttons.save')}
                        </button>
                        <button type="button" className="button" onClick={() => setEditingLabel(null)}>
                          {tCommon('buttons.cancel')}
                        </button>
                      </div>
                    </div>
                  )}

                  {reassigning === file.name && (
                    <div className="recordings-list__detail">
                      <label>
                        {t('reassign.prompt')}
                        <input type="text" inputMode="numeric" value={reassignInput} onChange={(e) => setReassignInput(e.target.value)} />
                      </label>
                      <p className="hint">{t('reassign.hint')}</p>
                      {reassignError && <p className="error-text">{reassignError}</p>}
                      <div className="recordings-list__detail-actions">
                        <button type="button" className="button button--primary" disabled={busy} onClick={() => void doReassign(file.name)}>
                          {t('reassign.confirm')}
                        </button>
                        <button type="button" className="button" onClick={() => setReassigning(null)}>
                          {tCommon('buttons.cancel')}
                        </button>
                      </div>
                    </div>
                  )}

                  {confirmDelete === file.name && (
                    <div className="note-box">
                      <p>{t('deletePen.confirm', { name: nameOf(file.name) })}</p>
                      <p className="hint">{t('deletePen.backupNotice')}</p>
                      <div className="recordings-list__detail-actions">
                        <button type="button" className="button button--primary" disabled={busy} onClick={() => void doDelete(file.name)}>
                          {t('actions.deleteFromPen')}
                        </button>
                        <button type="button" className="button" onClick={() => setConfirmDelete(null)}>
                          {tCommon('buttons.cancel')}
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="pane">
          <div className="pane__header">
            <h2>{t('backup.title')}</h2>
            <p className="hint">{t('backup.intro')}</p>
            {/* Said plainly, because a list of backups looks like clutter until you know none of
                them is going to be thrown away. */}
            <p className="hint">{t('backup.keptSeparately')}</p>
            {backups.length > 0 && (
              <label>
                {t('backup.choose')}
                <select value={selectedBackupId ?? ''} onChange={(e) => setSelectedBackupId(e.target.value)}>
                  {backups.map((b) => (
                    <option key={b.snapshotId} value={b.snapshotId}>
                      {backupLabel(b, t)} · {formatWhen(b.createdAtMs, i18n.language)} ·{' '}
                      {t('backup.countLabel', { count: b.recordingCount })}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
          <div className="pane__list">
            {backups.length === 0 && <p className="hint">{t('backup.none')}</p>}

            {/* The bug the owner found: the count was shown and the recordings never were. */}
            {backups.length > 0 && contents === null && <p className="hint">{t('backup.contentsLoading')}</p>}
            {contents?.status === 'no-such-backup' && <p className="error-text">{t('backup.missing')}</p>}
            {contents?.status === 'ok' && contents.entries.length === 0 && <p className="hint">{t('backup.contentsEmpty')}</p>}
            {contents?.status === 'ok' && contents.entries.length > 0 && (
              <>
                <div className="pane__toolbar">
                  <label>
                    <input
                      type="checkbox"
                      checked={chosen.size === contents.entries.length}
                      onChange={() =>
                        setChosen(
                          chosen.size === contents.entries.length
                            ? new Set()
                            : new Set(contents.entries.map((e) => e.fileName)),
                        )
                      }
                    />
                    {t('backup.selectAll')}
                  </label>
                  <span>{t('backup.selectedCount', { count: chosen.size })}</span>
                </div>
                <h3>{t('backup.contentsTitle')}</h3>
                <ul className="recordings-list">
                  {contents.entries.map((entry) => (
                    <li key={entry.fileName} className="recordings-list__row">
                      <label className="recordings-list__label">
                        <input
                          type="checkbox"
                          checked={chosen.has(entry.fileName)}
                          onChange={() =>
                            setChosen((prev) => {
                              const next = new Set(prev);
                              if (next.has(entry.fileName)) next.delete(entry.fileName);
                              else next.add(entry.fileName);
                              return next;
                            })
                          }
                        />
                        {/* The sticker number always, and the name they gave it if they gave it
                            one — the number is what is written on the sticker in their hand. */}
                        <span className="recordings-list__name">{stickerName(entry.fileName)}</span>
                        {entry.label && <span className="hint">{entry.label}</span>}
                      </label>
                      <span className="recordings-list__size">{formatSize(entry.sizeBytes, i18n.language)}</span>
                      <button
                        type="button"
                        className="button recordings-list__preview"
                        onClick={() =>
                          preview.state?.source === 'backup' && preview.state.fileName === entry.fileName
                            ? preview.stop()
                            : void preview.play('backup', entry.fileName, contents.snapshotId)
                        }
                      >
                        {preview.state?.source === 'backup' && preview.state.fileName === entry.fileName
                          ? t('preview.buttonPlaying')
                          : t('actions.play')}
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
          <div className="pane__footer">
            <button
              type="button"
              className="button button--primary"
              disabled={busy || !selectedBackupId || !penReady || chosen.size === 0}
              onClick={() => void startRestore()}
            >
              {t('restore.button')}
            </button>
            <p className="hint">{t('restore.buttonNote')}</p>
          </div>
        </section>
      </div>

      {message && <p className="hint">{message}</p>}

      {plan && (
        <div className="plan-panel">
          <h2>{t('restore.reviewTitle')}</h2>
          {clashes.length === 0 ? (
            <p>{t('restore.noClashes', { count: plan.items.filter((i) => i.state === 'new').length })}</p>
          ) : (
            <>
              <p>{t('restore.clashIntro')}</p>
              <ul className="recordings-list">
                {clashes.map((item) => (
                  <li key={item.fileName} className="recordings-list__row">
                    <span className="recordings-list__name">{item.label ?? item.fileName.replace(/\.mp3$/i, '')}</span>
                    <div className="recordings-list__detail">
                      <div className="recordings-list__detail-actions">
                        <span className="hint">{t('restore.fromBackup')}</span>
                        <button
                          type="button"
                          className="button"
                          onClick={() => void preview.play('backup', item.fileName, plan.snapshotId)}
                        >
                          {t('actions.play')}
                        </button>
                        <span className="hint">{t('restore.onPen')}</span>
                        <button type="button" className="button" onClick={() => void preview.play('pen', item.fileName)}>
                          {t('actions.play')}
                        </button>
                      </div>
                      <label>
                        <input
                          type="radio"
                          name={`decision-${item.fileName}`}
                          checked={decisions[item.fileName] === 'replace'}
                          onChange={() => setDecisions((d) => ({ ...d, [item.fileName]: 'replace' }))}
                        />
                        {t('restore.replace')}
                      </label>
                      <label>
                        <input
                          type="radio"
                          name={`decision-${item.fileName}`}
                          checked={decisions[item.fileName] === 'keep-pen'}
                          onChange={() => setDecisions((d) => ({ ...d, [item.fileName]: 'keep-pen' }))}
                        />
                        {t('restore.keepPen')}
                      </label>
                    </div>
                  </li>
                ))}
              </ul>
              {!allDecided && <p className="hint">{t('restore.decideAll')}</p>}
            </>
          )}
          <div className="recordings-list__detail-actions">
            <button type="button" className="button button--primary" disabled={busy || !allDecided} onClick={() => void confirmRestore()}>
              {restoring ? t('restore.working') : t('restore.confirm')}
            </button>
            <button type="button" className="button" onClick={() => setPlan(null)}>
              {tCommon('buttons.cancel')}
            </button>
          </div>
        </div>
      )}

      <AudioPreviewBar state={preview.state} onTogglePlayPause={preview.togglePlayPause} onSeek={preview.seek} onClose={preview.stop} />
    </div>
  );
}
