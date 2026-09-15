import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { FirmwarePackageInfo, FirmwareProgressEvent, FirmwareRecoveryStatus, FirmwareUpgradeOutcome } from '@shared/types';
import { usePenRoot } from '../state/PenRootContext';

type WizardStep = 'prepare' | 'package' | 'confirm' | 'upgrading' | 'result';

const PHASE_KEY: Record<FirmwareProgressEvent['phase'], string> = {
  'preparing-launcher': 'upgrading.phasePreparing',
  'awaiting-authorization-or-starting': 'upgrading.phaseAwaitingAuth',
  'tool-running': 'upgrading.phaseToolRunning',
  finishing: 'upgrading.phaseFinishing',
};

export function FirmwareScreen() {
  const { t } = useTranslation('firmware');
  const penRoot = usePenRoot();
  const isMac = window.ponyabc.platform === 'darwin';
  const penConnected = penRoot.result.status === 'ok';

  const [step, setStep] = useState<WizardStep>('prepare');
  const [packageInfo, setPackageInfo] = useState<FirmwarePackageInfo | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [starting, setStarting] = useState(false);
  const [startMessage, setStartMessage] = useState<string | null>(null);
  const [progress, setProgress] = useState<FirmwareProgressEvent | null>(null);
  const [outcome, setOutcome] = useState<FirmwareUpgradeOutcome | null>(null);
  const [acknowledging, setAcknowledging] = useState(false);
  const [restartNoticeShown, setRestartNoticeShown] = useState(false);
  const [recovery, setRecovery] = useState<FirmwareRecoveryStatus | null>(null);
  const [rechecking, setRechecking] = useState(false);
  const logRef = useRef<HTMLPreElement | null>(null);

  // A previous session's firmware upgrade may not have been confirmed finished — see
  // src/main/ipc/firmware.ts's checkPendingFirmwareRecoveryOnStartup. This is checked once by
  // the main process before this window even exists; here we just read the result and, while it
  // is anything but 'none', render a dedicated blocking screen below instead of the normal
  // wizard — a real process check is the only thing that can clear it, never this component
  // re-mounting or the user navigating around.
  useEffect(() => {
    if (isMac) return;
    let cancelled = false;
    void window.ponyabc.getFirmwareRecoveryStatus().then((status) => {
      if (!cancelled) setRecovery(status);
    });
    return () => {
      cancelled = true;
    };
  }, [isMac]);

  async function handleRecheck() {
    setRechecking(true);
    try {
      const status = await window.ponyabc.recheckFirmwareRecovery();
      setRecovery(status);
    } finally {
      setRechecking(false);
    }
  }

  useEffect(() => {
    if (isMac) return;
    return window.ponyabc.onFirmwareProgress((event) => setProgress(event));
  }, [isMac]);

  useEffect(() => {
    if (isMac) return;
    return window.ponyabc.onFirmwareOutcome((event) => {
      setOutcome(event);
      setStep('result');
      setRestartNoticeShown(false);
    });
  }, [isMac]);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [progress]);

  async function handleSelectPackage() {
    setSelecting(true);
    setStartMessage(null);
    try {
      const result = await window.ponyabc.selectFirmwarePackage();
      if (result.status === 'selected') setPackageInfo(result.info);
    } finally {
      setSelecting(false);
    }
  }

  async function handleStart() {
    if (!packageInfo) return;
    setStarting(true);
    setStartMessage(null);
    try {
      const result = await window.ponyabc.startFirmwareUpgrade({ packageDir: packageInfo.rootDir });
      if (result.status === 'started') {
        setProgress(null);
        setOutcome(null);
        setStep('upgrading');
      } else if (result.status === 'already-in-progress') {
        setStartMessage(t('confirm.alreadyInProgress'));
      } else if (result.status === 'no-pen-selected') {
        setStartMessage(t('prepare.penRequired'));
      } else if (result.status === 'invalid-package') {
        setStartMessage(t('package.invalid'));
      } else {
        setStartMessage(t('confirm.unsupportedPlatform'));
      }
    } finally {
      setStarting(false);
    }
  }

  /** Only for an outcome with `processTerminationConfirmed: true` — see the branch in the
   *  render below. Resets the wizard because the backend has genuinely released the lock. */
  async function handleAcknowledge() {
    setAcknowledging(true);
    try {
      await window.ponyabc.acknowledgeFirmwareOutcome();
    } finally {
      setAcknowledging(false);
      setStep('prepare');
      setPackageInfo(null);
      setProgress(null);
      setOutcome(null);
    }
  }

  /**
   * Only for an outcome with `processTerminationConfirmed: false` — the real device's status is
   * genuinely unknown, so unlike handleAcknowledge this deliberately does NOT reset the wizard
   * or clear the outcome: the backend keeps the pen lock and the firmware in-progress guard held
   * with no in-app release path (acknowledgeFirmwareOutcome() is a no-op for this case — see
   * src/main/ipc/firmware.ts). This only records that the user has seen the warning and shows a
   * persistent notice; the only real recovery is fully quitting and reopening the app.
   */
  async function handleAcknowledgeUnconfirmed() {
    setAcknowledging(true);
    try {
      await window.ponyabc.acknowledgeFirmwareOutcome();
    } finally {
      setAcknowledging(false);
      setRestartNoticeShown(true);
    }
  }

  function startOver() {
    setStep('prepare');
    setPackageInfo(null);
    setStartMessage(null);
    setProgress(null);
    setOutcome(null);
    setRestartNoticeShown(false);
  }

  if (isMac) {
    return (
      <div className="screen">
        <h1>{t('title')}</h1>
        <div className="not-implemented-banner">{t('macRequiresWindows')}</div>
      </div>
    );
  }

  if (recovery && (recovery.status === 'still-running' || recovery.status === 'unknown' || recovery.status === 'checking')) {
    return (
      <div className="screen">
        <h1>{t('title')}</h1>
        <section>
          <h2>{t('recovery.title')}</h2>
          <div className="note-box">
            <p className="error-text">
              {recovery.status === 'checking'
                ? t('recovery.checking')
                : recovery.status === 'still-running'
                  ? t('recovery.stillRunningBody')
                  : t('recovery.unknownBody')}
            </p>
          </div>
          <p className="hint">{t('recovery.startedAt', { time: new Date(recovery.pending.startedAtMs).toLocaleString() })}</p>
          {recovery.status !== 'checking' && (
            <p className="hint">{t('recovery.lastChecked', { time: new Date(recovery.lastCheckedAtMs).toLocaleString() })}</p>
          )}
          <button
            type="button"
            className="button button--primary"
            disabled={rechecking || recovery.status === 'checking'}
            onClick={() => void handleRecheck()}
          >
            {rechecking ? t('recovery.checking') : t('recovery.checkAgainButton')}
          </button>
        </section>
      </div>
    );
  }

  return (
    <div className="screen">
      <h1>{t('title')}</h1>
      <ol className="wizard-steps">
        {(['prepare', 'package', 'confirm', 'upgrading', 'result'] as WizardStep[]).map((s) => (
          <li key={s} className={s === step ? 'wizard-steps__current' : undefined}>
            {t(`steps.${s}`)}
          </li>
        ))}
      </ol>

      {step === 'prepare' && (
        <section>
          <h2>{t('prepare.title')}</h2>
          <ul>
            <li>{t('prepare.checklistUsb')}</li>
            <li>{t('prepare.checklistPower')}</li>
            <li>{t('prepare.checklistNoOtherOps')}</li>
          </ul>
          <p className="hint">{penConnected ? t('prepare.penDetected') : t('prepare.penRequired')}</p>
          <button type="button" className="button button--primary" disabled={!penConnected} onClick={() => setStep('package')}>
            {t('prepare.nextButton')}
          </button>
        </section>
      )}

      {step === 'package' && (
        <section>
          <h2>{t('package.title')}</h2>
          <p className="hint">{t('package.devModeNotice')}</p>
          <button type="button" className="button" disabled={selecting} onClick={() => void handleSelectPackage()}>
            {t('package.selectButton')}
          </button>
          {packageInfo && (
            <div className="firmware-package-info">
              <p>{t('package.selectedPath', { path: packageInfo.rootDir })}</p>
              {packageInfo.looksValid ? (
                <p className="hint">{t('package.looksValid')}</p>
              ) : (
                <>
                  <p className="error-text">{t('package.invalid')}</p>
                  <ul>
                    {packageInfo.missingFiles.map((f) => (
                      <li key={f}>{f}</li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}
          <div className="firmware-wizard__actions">
            <button type="button" className="button" onClick={() => setStep('prepare')}>
              {t('back')}
            </button>
            <button
              type="button"
              className="button button--primary"
              disabled={!packageInfo?.looksValid}
              onClick={() => setStep('confirm')}
            >
              {t('package.nextButton')}
            </button>
          </div>
        </section>
      )}

      {step === 'confirm' && packageInfo && (
        <section>
          <h2>{t('confirm.title')}</h2>
          <p>{t('confirm.summary', { path: packageInfo.rootDir })}</p>
          <p className="hint">{t('confirm.uacNotice')}</p>
          {startMessage && <p className="error-text">{startMessage}</p>}
          <div className="firmware-wizard__actions">
            <button type="button" className="button" disabled={starting} onClick={() => setStep('package')}>
              {t('back')}
            </button>
            <button type="button" className="button button--primary" disabled={starting} onClick={() => void handleStart()}>
              {t('confirm.startButton')}
            </button>
          </div>
        </section>
      )}

      {step === 'upgrading' && (
        <section>
          <h2>{t('upgrading.title')}</h2>
          <p className="firmware-wizard__phase">
            <span className="firmware-wizard__spinner" aria-hidden="true" />
            {t(progress ? PHASE_KEY[progress.phase] : 'upgrading.phasePreparing')}
          </p>
          <p className="hint">{t('upgrading.noCancelNotice')}</p>
          <pre ref={logRef} className="firmware-wizard__log">
            {progress?.logTailText || t('upgrading.noOutputYet')}
          </pre>
        </section>
      )}

      {step === 'result' && outcome && (
        <section>
          <h2>{t('result.title')}</h2>
          {outcome.status === 'success' && (
            <div className="note-box">
              <p>{t('result.successTitle')}</p>
              <p className="hint">{t('result.reason', { reason: outcome.reason })}</p>
            </div>
          )}
          {outcome.status === 'failed' && (
            <div className="note-box">
              <p className="error-text">{t('result.failedTitle')}</p>
              <p className="hint">{t('result.reason', { reason: outcome.reason })}</p>
            </div>
          )}
          {outcome.status === 'unclear' && (
            <div className="note-box">
              <p className="error-text">{t('result.unclearTitle')}</p>
              <p className="hint">{outcome.processTerminationConfirmed ? t('result.unclearBody') : t('result.unclearBodyUnconfirmed')}</p>
              <p className="hint">{t('result.reason', { reason: outcome.reason })}</p>
            </div>
          )}
          <pre className="firmware-wizard__log">{outcome.logExcerpt || t('upgrading.noOutputYet')}</pre>
          {outcome.status === 'unclear' ? (
            outcome.processTerminationConfirmed ? (
              <button type="button" className="button button--primary" disabled={acknowledging} onClick={() => void handleAcknowledge()}>
                {t('result.acknowledgeButton')}
              </button>
            ) : restartNoticeShown ? (
              <p className="hint">{t('result.restartNoticeAcknowledged')}</p>
            ) : (
              <button
                type="button"
                className="button button--primary"
                disabled={acknowledging}
                onClick={() => void handleAcknowledgeUnconfirmed()}
              >
                {t('result.acknowledgeButtonUnconfirmed')}
              </button>
            )
          ) : (
            <button type="button" className="button button--primary" onClick={startOver}>
              {t('result.startOverButton')}
            </button>
          )}
        </section>
      )}
    </div>
  );
}
