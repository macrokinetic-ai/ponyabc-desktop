import { useTranslation } from 'react-i18next';
import type { AudioPreviewState } from '../hooks/useAudioPreview';

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

const ERROR_KEY: Record<string, string> = {
  'not-found': 'preview.errorNotFound',
  rejected: 'preview.errorRejected',
  'device-disconnected': 'preview.errorDeviceDisconnected',
  'no-pen-selected': 'preview.errorDeviceDisconnected',
  'no-computer-folder-selected': 'preview.errorNotFound',
  invalid: 'preview.errorDeviceDisconnected',
  'too-large': 'preview.errorTooLarge',
  error: 'preview.errorGeneric',
};

/** The single shared player for both panes — playback itself happens via the Web Audio API
 *  (see useAudioPreview), not a native <audio> element, since real pen recordings are often
 *  MPEG Layer II ("*.mp3" in name only) which Chromium's built-in decoder cannot play. */
export function AudioPreviewBar({
  state,
  onTogglePlayPause,
  onSeek,
  onClose,
}: {
  state: AudioPreviewState | null;
  onTogglePlayPause: () => void;
  onSeek: (time: number) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation('recordings');

  if (!state) return null;

  return (
    <div className="audio-preview-bar">
      <div className="audio-preview-bar__info">
        <span className="audio-preview-bar__source">{t(state.source === 'pen' ? 'preview.sourcePen' : 'preview.sourceComputer')}</span>
        <span className="audio-preview-bar__filename">{state.fileName}</span>
        {state.source === 'computer' && state.status === 'ready' && <p className="hint">{t('preview.penEncodingHint')}</p>}
      </div>

      {state.status === 'loading' && <p className="hint">{t('preview.loading')}</p>}
      {state.status === 'error' && <p className="error-text">{t(ERROR_KEY[state.errorStatus ?? 'error'] ?? 'preview.errorGeneric')}</p>}

      {state.status === 'ready' && (
        <div className="audio-preview-bar__controls">
          <button type="button" className="button" onClick={onTogglePlayPause}>
            {state.playing ? '⏸' : '▶'}
          </button>
          <input
            type="range"
            className="audio-preview-bar__seek"
            min={0}
            max={state.duration || 0}
            step={0.1}
            value={Math.min(state.currentTime, state.duration || 0)}
            onChange={(e) => onSeek(Number(e.target.value))}
            disabled={!state.duration}
          />
          <span className="audio-preview-bar__time">
            {formatTime(state.currentTime)} / {formatTime(state.duration)}
          </span>
        </div>
      )}

      <button type="button" className="button audio-preview-bar__close" onClick={onClose} aria-label={t('preview.close')}>
        ✕
      </button>
    </div>
  );
}
