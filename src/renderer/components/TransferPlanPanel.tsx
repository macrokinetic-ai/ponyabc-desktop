import { useTranslation } from 'react-i18next';
import type { ConflictDecision, TransferToPenPlan, TransferToPenSummary } from '@shared/types';
import { REASON_KEY } from '../reasonKeys';

function formatBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.round(n / 1024)} KB`;
}

export function TransferPlanPanel({
  plan,
  decisions,
  onDecisionChange,
  onConfirm,
  onCancel,
  busy,
  summary,
}: {
  plan: TransferToPenPlan;
  decisions: Record<string, ConflictDecision>;
  onDecisionChange: (fileName: string, decision: ConflictDecision) => void;
  onConfirm: () => void;
  onCancel: () => void;
  busy: boolean;
  summary: TransferToPenSummary | null;
}) {
  const { t } = useTranslation('recordings');

  const allConflictsDecided = plan.conflicts.every((c) => decisions[c.fileName]);
  // Once a summary is showing, this plan has already been sent — prevent an accidental
  // second send of the same batch; the teacher must request a fresh plan to send again.
  const canConfirm = allConflictsDecided && plan.hasEnoughSpace && !busy && summary === null;

  return (
    <div className="plan-panel">
      <h2>{t('transferPlan.title')}</h2>
      <p>{t('transferPlan.destination', { volume: plan.destinationVolumeLabel })}</p>
      <p className={plan.hasEnoughSpace ? '' : 'error-text'}>
        {t('transferPlan.space', { required: formatBytes(plan.requiredBytes), free: formatBytes(plan.freeBytes) })}
        {!plan.hasEnoughSpace && ` — ${t('transferPlan.notEnoughSpace')}`}
      </p>

      {plan.toAdd.length > 0 && (
        <>
          <h3>{t('transferPlan.toAddTitle', { count: plan.toAdd.length })}</h3>
          <p className="hint">{t('transferPlan.toAddHint')}</p>
          <ul className="recordings-list">
            {plan.toAdd.map((item) => (
              <li key={item.fileName}>
                {item.fileName} <span className="recordings-list__size">{formatBytes(item.sizeBytes)}</span>
              </li>
            ))}
          </ul>
        </>
      )}

      {plan.conflicts.length > 0 && (
        <>
          <h3>{t('transferPlan.conflictsTitle', { count: plan.conflicts.length })}</h3>
          <p className="hint">{t('transferPlan.conflictsHint')}</p>
          <ul className="recordings-list">
            {plan.conflicts.map((c) => (
              <li key={c.fileName}>
                <div>
                  {c.fileName} <span className="recordings-list__size">{formatBytes(c.existingSizeBytes)} → {formatBytes(c.sourceSizeBytes)}</span>
                </div>
                <label>
                  <input
                    type="radio"
                    name={`decision-${c.fileName}`}
                    checked={decisions[c.fileName] === 'replace'}
                    onChange={() => onDecisionChange(c.fileName, 'replace')}
                  />
                  {t('transferPlan.replace')}
                </label>
                <label>
                  <input
                    type="radio"
                    name={`decision-${c.fileName}`}
                    checked={decisions[c.fileName] === 'skip'}
                    onChange={() => onDecisionChange(c.fileName, 'skip')}
                  />
                  {t('transferPlan.skip')}
                </label>
              </li>
            ))}
          </ul>
        </>
      )}

      {plan.rejected.length > 0 && (
        <>
          <h3>{t('transferPlan.rejectedTitle', { count: plan.rejected.length })}</h3>
          <ul className="recordings-list">
            {plan.rejected.map((r) => (
              <li key={r.fileName}>{r.fileName}</li>
            ))}
          </ul>
        </>
      )}

      {!allConflictsDecided && plan.conflicts.length > 0 && <p className="hint">{t('transferPlan.decideAllHint')}</p>}

      <div className="plan-panel__actions">
        <button type="button" className="button" onClick={onCancel} disabled={busy}>
          {t('transferPlan.cancel')}
        </button>
        <button type="button" className="button button--primary" onClick={onConfirm} disabled={!canConfirm}>
          {t('transferPlan.confirm')}
        </button>
      </div>

      {summary && (
        <div className="copy-summary">
          <h3>{t('transferPlan.summaryTitle')}</h3>
          <p>{t('transferPlan.summaryAdded', { count: summary.added.length })}</p>
          <p>{t('transferPlan.summaryReplaced', { count: summary.replaced.length })}</p>
          {summary.replaced.length > 0 && (
            <ul>
              {summary.replaced.map((r) => (
                <li key={r.fileName}>{t('transferPlan.backupDetail', { fileName: r.fileName, backupPath: r.backupPath })}</li>
              ))}
            </ul>
          )}
          <p>{t('transferPlan.summarySkipped', { count: summary.skipped.length })}</p>
          {summary.failed.length > 0 && (
            <>
              <p>{t('transferPlan.summaryFailed', { count: summary.failed.length })}</p>
              <ul>
                {summary.failed.map((f) => (
                  <li key={f.file}>{t('failedDetail', { file: f.file, message: t(REASON_KEY[f.reason]) })}</li>
                ))}
              </ul>
            </>
          )}
          {summary.status === 'stale-plan' && <p className="error-text">{summary.message}</p>}
          {summary.backupFolder && <p className="hint">{t('transferPlan.backupFolder', { path: summary.backupFolder })}</p>}
        </div>
      )}
    </div>
  );
}
