import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  ComputerFile,
  ComputerFolderListResult,
  ConflictDecision,
  CopySummary,
  RecordingFile,
  RecordingsListResult,
  ReplaceStickerPlanResult,
  ReplaceStickerSummary,
  TransferToPenPlanResult,
  TransferToPenSummary,
} from '@shared/types';
import { PenRootBar } from '../components/PenRootBar';
import { ComputerFolderBar } from '../components/ComputerFolderBar';
import { TransferPlanPanel } from '../components/TransferPlanPanel';
import { ReplaceStickerPanel } from '../components/ReplaceStickerPanel';
import { usePenRoot } from '../state/PenRootContext';
import { useComputerFolder } from '../state/ComputerFolderContext';
import { useTransferProgress } from '../hooks/useCopyProgress';
import { REASON_KEY } from '../reasonKeys';

type Busy = null | 'toComputer' | 'planToPen' | 'executeToPen' | 'planReplace' | 'executeReplace';

export function MyRecordingsScreen() {
  const { t } = useTranslation('recordings');
  const { t: tCommon } = useTranslation('common');
  const { result: penRootResult } = usePenRoot();
  const { result: computerFolderResult } = useComputerFolder();

  const [penFiles, setPenFiles] = useState<RecordingsListResult | null>(null);
  const [computerFiles, setComputerFiles] = useState<ComputerFolderListResult | null>(null);
  const [penSelected, setPenSelected] = useState<Set<string>>(new Set());
  const [computerSelected, setComputerSelected] = useState<Set<string>>(new Set());

  const [busy, setBusy] = useState<Busy>(null);
  const [generalError, setGeneralError] = useState<string | null>(null);
  const { progress, reset: resetProgress } = useTransferProgress();

  const [saveSummary, setSaveSummary] = useState<CopySummary | null>(null);
  const [transferPlan, setTransferPlan] = useState<TransferToPenPlanResult | null>(null);
  const [decisions, setDecisions] = useState<Record<string, ConflictDecision>>({});
  const [transferSummary, setTransferSummary] = useState<TransferToPenSummary | null>(null);

  const [replacePlan, setReplacePlan] = useState<ReplaceStickerPlanResult | null>(null);
  const [replaceSummary, setReplaceSummary] = useState<ReplaceStickerSummary | null>(null);

  const refreshPenFiles = useCallback(async () => {
    const res = await window.ponyabc.listDiyRecordings();
    setPenFiles(res);
    if (res.status !== 'ok') setPenSelected(new Set());
    else setPenSelected((prev) => new Set([...prev].filter((n) => res.files.some((f) => f.name === n))));
  }, []);

  const refreshComputerFiles = useCallback(async () => {
    const res = await window.ponyabc.listComputerFolder();
    setComputerFiles(res);
    if (res.status !== 'ok') setComputerSelected(new Set());
    else setComputerSelected((prev) => new Set([...prev].filter((n) => res.files.some((f) => f.name === n))));
  }, []);

  // Re-list on entering this screen (covers "return to related page") and whenever the pen
  // or computer folder identity changes.
  useEffect(() => {
    void refreshPenFiles();
  }, [refreshPenFiles, penRootResult]);

  useEffect(() => {
    void refreshComputerFiles();
  }, [refreshComputerFiles, computerFolderResult]);

  // A pen switch (including disconnect) invalidates any pending send-to-pen plan/decisions —
  // the teacher must recompute and reconfirm for the newly-connected pen. The right-pane
  // folder and file selection are deliberately NOT reset here, so a batch selected once can
  // be sent to several pens in a row without re-picking files each time.
  const penIdentityKey = penRootResult.status === 'ok' ? `${penRootResult.path}#${penRootResult.generation}` : penRootResult.status;
  useEffect(() => {
    setTransferPlan(null);
    setDecisions({});
    setTransferSummary(null);
    setReplacePlan(null);
    setReplaceSummary(null);
  }, [penIdentityKey]);

  const penFileList: RecordingFile[] = penFiles?.status === 'ok' ? penFiles.files : [];
  const computerFileList: ComputerFile[] = computerFiles?.status === 'ok' ? computerFiles.files : [];

  const penAllSelected = penFileList.length > 0 && penSelected.size === penFileList.length;
  const computerAllSelected = computerFileList.length > 0 && computerSelected.size === computerFileList.length;

  function togglePenFile(name: string) {
    setPenSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }
  function toggleComputerFile(name: string) {
    setComputerSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  const penReady = penRootResult.status === 'ok';
  const computerReady = computerFolderResult.status === 'ok';

  async function handleSaveToComputer() {
    setGeneralError(null);
    setSaveSummary(null);
    resetProgress();
    setBusy('toComputer');
    try {
      const result = await window.ponyabc.copyRecordingsToComputer(Array.from(penSelected));
      setSaveSummary(result);
      await refreshComputerFiles();
    } catch (err) {
      setGeneralError(tCommon('errors.generic', { message: err instanceof Error ? err.message : String(err) }));
    } finally {
      setBusy(null);
    }
  }

  async function handlePlanTransferToPen() {
    setGeneralError(null);
    setTransferSummary(null);
    setBusy('planToPen');
    try {
      const plan = await window.ponyabc.planTransferToPen(Array.from(computerSelected));
      setTransferPlan(plan);
      setDecisions({});
    } catch (err) {
      setGeneralError(tCommon('errors.generic', { message: err instanceof Error ? err.message : String(err) }));
    } finally {
      setBusy(null);
    }
  }

  async function handleConfirmTransferToPen() {
    if (!transferPlan || transferPlan.status !== 'ok') return;
    const plan = transferPlan;
    setBusy('executeToPen');
    resetProgress();
    try {
      const fileNames = [...plan.toAdd.map((i) => i.fileName), ...plan.conflicts.map((c) => c.fileName)];
      const summary = await window.ponyabc.executeTransferToPen({ fileNames, decisions, penGeneration: plan.penGeneration });
      // Keep the plan mounted so its panel can show the summary — it's replaced wholesale
      // the next time a plan is requested (handlePlanTransferToPen), never reused for a
      // second send without the teacher explicitly confirming again.
      setTransferSummary(summary);
      await refreshPenFiles();
    } catch (err) {
      setGeneralError(tCommon('errors.generic', { message: err instanceof Error ? err.message : String(err) }));
    } finally {
      setBusy(null);
    }
  }

  async function handlePlanReplaceSticker() {
    if (penSelected.size !== 1 || computerSelected.size !== 1) return;
    setGeneralError(null);
    setReplaceSummary(null);
    setBusy('planReplace');
    try {
      const penFileName = Array.from(penSelected)[0];
      const computerFileName = Array.from(computerSelected)[0];
      const plan = await window.ponyabc.planReplaceSticker({ penFileName, computerFileName });
      setReplacePlan(plan);
    } catch (err) {
      setGeneralError(tCommon('errors.generic', { message: err instanceof Error ? err.message : String(err) }));
    } finally {
      setBusy(null);
    }
  }

  async function handleConfirmReplaceSticker() {
    if (!replacePlan || replacePlan.status !== 'ok') return;
    const plan = replacePlan;
    setBusy('executeReplace');
    resetProgress();
    try {
      const summary = await window.ponyabc.executeReplaceSticker({
        penFileName: plan.penFileName,
        computerFileName: plan.computerFileName,
        penGeneration: plan.penGeneration,
      });
      setReplaceSummary(summary);
      await refreshPenFiles();
    } catch (err) {
      setGeneralError(tCommon('errors.generic', { message: err instanceof Error ? err.message : String(err) }));
    } finally {
      setBusy(null);
    }
  }

  const saveFailedWithLabels = useMemo(
    () => (saveSummary?.failed ?? []).map((f) => ({ ...f, reasonLabel: t(REASON_KEY[f.reason]) })),
    [saveSummary, t],
  );
  const saveTotalSaved = (saveSummary?.succeeded.length ?? 0) + (saveSummary?.renamed.length ?? 0);

  function saveSummaryMessage(s: CopySummary): string | null {
    switch (s.status) {
      case 'no-pen-selected':
        return t('noPenSelected');
      case 'no-computer-folder-selected':
        return t('noComputerFolderSelected');
      case 'invalid-destination':
        return t('destinationOnPen');
      case 'device-disconnected':
        return t('deviceDisconnected');
      case 'error':
        return tCommon('errors.generic', { message: s.message ?? '' });
      case 'completed':
        return null;
    }
  }

  const canReplaceSticker = penReady && computerReady && penSelected.size === 1 && computerSelected.size === 1 && busy === null;

  return (
    <div className="screen">
      <h1>{t('title')}</h1>

      <div className="dual-pane">
        <section className="pane">
          <div className="pane__header">
            <PenRootBar />
            {penReady && penFiles?.status === 'ok' && (
              <div className="pane__toolbar">
                <label>
                  <input type="checkbox" checked={penAllSelected} onChange={() => setPenSelected(penAllSelected ? new Set() : new Set(penFileList.map((f) => f.name)))} />
                  {t('selectAll')}
                </label>
                <span>{t('selectedCount', { count: penSelected.size })}</span>
                <button type="button" className="button" onClick={() => void refreshPenFiles()}>
                  {tCommon('buttons.refresh')}
                </button>
              </div>
            )}
          </div>
          <div className="pane__list">
            {!penReady && <p className="hint">{t('noPenSelected')}</p>}
            {penReady && penFiles?.status === 'invalid' && (
              <p className="error-text">{tCommon('penRoot.missingFolders', { folders: penFiles.missing.join(', ') })}</p>
            )}
            {penReady && penFiles?.status === 'device-disconnected' && <p className="error-text">{t('deviceDisconnected')}</p>}
            {penReady && penFiles?.status === 'error' && <p className="error-text">{penFiles.message}</p>}
            {penReady && penFiles?.status === 'ok' && penFileList.length === 0 && <p className="hint">{t('emptyState')}</p>}
            {penReady && penFiles?.status === 'ok' && penFileList.length > 0 && (
              <ul className="recordings-list">
                {penFileList.map((file) => (
                  <li key={file.name}>
                    <label>
                      <input type="checkbox" checked={penSelected.has(file.name)} onChange={() => togglePenFile(file.name)} />
                      {file.name}
                      <span className="recordings-list__size">{Math.round(file.sizeBytes / 1024)} KB</span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        <div className="dual-pane__actions">
          <button
            type="button"
            className="button button--primary"
            disabled={!penReady || !computerReady || penSelected.size === 0 || busy !== null}
            onClick={() => void handleSaveToComputer()}
          >
            {t('actions.saveToComputer')}
          </button>
          <button
            type="button"
            className="button button--primary"
            disabled={!penReady || !computerReady || computerSelected.size === 0 || busy !== null}
            onClick={() => void handlePlanTransferToPen()}
          >
            {t('actions.sendToPen')}
          </button>
          <button type="button" className="button" disabled={!canReplaceSticker} onClick={() => void handlePlanReplaceSticker()}>
            {t('actions.replaceSticker')}
          </button>
        </div>

        <section className="pane">
          <div className="pane__header">
            <ComputerFolderBar />
            {computerReady && computerFiles?.status === 'ok' && (
              <div className="pane__toolbar">
                <label>
                  <input
                    type="checkbox"
                    checked={computerAllSelected}
                    onChange={() => setComputerSelected(computerAllSelected ? new Set() : new Set(computerFileList.map((f) => f.name)))}
                  />
                  {t('selectAll')}
                </label>
                <span>{t('selectedCount', { count: computerSelected.size })}</span>
                <button type="button" className="button" onClick={() => void refreshComputerFiles()}>
                  {tCommon('buttons.refresh')}
                </button>
              </div>
            )}
          </div>
          <div className="pane__list">
            {!computerReady && <p className="hint">{t('noComputerFolderSelected')}</p>}
            {computerReady && computerFiles?.status === 'not-found' && <p className="error-text">{tCommon('penRoot.notFound')}</p>}
            {computerReady && computerFiles?.status === 'error' && <p className="error-text">{computerFiles.message}</p>}
            {computerReady && computerFiles?.status === 'ok' && computerFileList.length === 0 && <p className="hint">{t('computerEmptyState')}</p>}
            {computerReady && computerFiles?.status === 'ok' && computerFileList.length > 0 && (
              <ul className="recordings-list">
                {computerFileList.map((file) => (
                  <li key={file.name}>
                    <label>
                      <input type="checkbox" checked={computerSelected.has(file.name)} onChange={() => toggleComputerFile(file.name)} />
                      {file.name}
                      <span className="recordings-list__size">{Math.round(file.sizeBytes / 1024)} KB</span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>

      {generalError && <p className="error-text">{generalError}</p>}

      {busy && (
        <p className="hint">
          {progress
            ? t('copying', { current: progress.fileIndex + 1, total: progress.fileCount, fileName: progress.fileName })
            : '…'}
        </p>
      )}

      {saveSummary && (
        <div className="copy-summary">
          <h2>{t('summaryTitle')}</h2>
          {saveSummaryMessage(saveSummary) && <p className="error-text">{saveSummaryMessage(saveSummary)}</p>}
          {(saveSummary.status === 'completed' || saveSummary.status === 'device-disconnected') && (
            <>
              <p>{t('summarySucceeded', { count: saveTotalSaved })}</p>
              {saveSummary.renamed.length > 0 && (
                <>
                  <p>{t('summaryRenamed', { count: saveSummary.renamed.length })}</p>
                  <ul>
                    {saveSummary.renamed.map((r) => (
                      <li key={r.original}>{t('renamedDetail', { original: r.original, savedAs: r.savedAs })}</li>
                    ))}
                  </ul>
                  <p className="hint">{t('summaryRenamedStickerHint')}</p>
                </>
              )}
              {saveFailedWithLabels.length > 0 && (
                <>
                  <p>{t('summaryFailed', { count: saveFailedWithLabels.length })}</p>
                  <ul>
                    {saveFailedWithLabels.map((f) => (
                      <li key={f.file}>{t('failedDetail', { file: f.file, message: f.reasonLabel })}</li>
                    ))}
                  </ul>
                </>
              )}
            </>
          )}
        </div>
      )}

      {transferPlan && transferPlan.status === 'ok' && (
        <TransferPlanPanel
          plan={transferPlan}
          decisions={decisions}
          onDecisionChange={(fileName, decision) => setDecisions((prev) => ({ ...prev, [fileName]: decision }))}
          onConfirm={() => void handleConfirmTransferToPen()}
          onCancel={() => {
            setTransferPlan(null);
            setDecisions({});
          }}
          busy={busy === 'executeToPen'}
          summary={transferSummary}
        />
      )}
      {transferPlan && transferPlan.status !== 'ok' && (
        <p className="error-text">
          {transferPlan.status === 'no-pen-selected' && t('noPenSelected')}
          {transferPlan.status === 'no-computer-folder-selected' && t('noComputerFolderSelected')}
          {transferPlan.status === 'device-disconnected' && t('deviceDisconnected')}
          {transferPlan.status === 'invalid' && tCommon('penRoot.missingFolders', { folders: transferPlan.missing.join(', ') })}
          {transferPlan.status === 'error' && transferPlan.message}
        </p>
      )}

      {replacePlan && replacePlan.status === 'ok' && (
        <ReplaceStickerPanel
          plan={replacePlan}
          onConfirm={() => void handleConfirmReplaceSticker()}
          onCancel={() => setReplacePlan(null)}
          busy={busy === 'executeReplace'}
          summary={replaceSummary}
        />
      )}
      {replacePlan && replacePlan.status !== 'ok' && (
        <p className="error-text">
          {replacePlan.status === 'no-pen-selected' && t('noPenSelected')}
          {replacePlan.status === 'no-computer-folder-selected' && t('noComputerFolderSelected')}
          {replacePlan.status === 'device-disconnected' && t('deviceDisconnected')}
          {replacePlan.status === 'invalid' && tCommon('penRoot.missingFolders', { folders: replacePlan.missing.join(', ') })}
          {replacePlan.status === 'not-found' && t('replaceSticker.sourceGone')}
          {replacePlan.status === 'error' && replacePlan.message}
        </p>
      )}
    </div>
  );
}
