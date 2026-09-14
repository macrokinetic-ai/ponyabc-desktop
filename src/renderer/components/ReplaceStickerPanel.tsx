import { useTranslation } from 'react-i18next';
import type { ReplaceStickerPlan, ReplaceStickerSummary } from '@shared/types';

function formatBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.round(n / 1024)} KB`;
}

export function ReplaceStickerPanel({
  plan,
  onConfirm,
  onCancel,
  busy,
  summary,
}: {
  plan: ReplaceStickerPlan;
  onConfirm: () => void;
  onCancel: () => void;
  busy: boolean;
  summary: ReplaceStickerSummary | null;
}) {
  const { t } = useTranslation('recordings');

  return (
    <div className="plan-panel">
      <h2>{t('replaceSticker.title')}</h2>
      <p className="plan-panel__confirm-text">
        {t('replaceSticker.confirmText', { computerFileName: plan.computerFileName, penFileName: plan.penFileName })}
      </p>
      <p className="hint">
        {t('replaceSticker.sizes', { computerSize: formatBytes(plan.computerFileSizeBytes), penSize: formatBytes(plan.penFileSizeBytes) })}
      </p>
      <p className="hint">{t('replaceSticker.noRename')}</p>

      <div className="plan-panel__actions">
        <button type="button" className="button" onClick={onCancel} disabled={busy}>
          {t('transferPlan.cancel')}
        </button>
        <button type="button" className="button button--primary" onClick={onConfirm} disabled={busy || summary !== null}>
          {t('replaceSticker.confirmButton')}
        </button>
      </div>

      {summary && (
        <div className="copy-summary">
          {summary.status === 'completed' && <p>{t('replaceSticker.success')}</p>}
          {summary.status !== 'completed' && <p className="error-text">{summary.message ?? t('replaceSticker.failed')}</p>}
          {summary.backupPath && <p className="hint">{t('transferPlan.backupFolder', { path: summary.backupPath })}</p>}
        </div>
      )}
    </div>
  );
}
