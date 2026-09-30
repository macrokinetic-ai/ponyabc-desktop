import { useTranslation } from 'react-i18next';
import { formatSpace, formatGb, penStorage } from '@shared/penStorage';

/**
 * How much room is left on the pen, on both the Books and My Recordings screens.
 *
 * Plain words and one sentence first — "12.4 GB of 14.8 GB used" — because that is the only line
 * most people need. The breakdown underneath says what is taking the room, so "your pen is full"
 * becomes something a teacher can act on.
 *
 * When the pen's space could not be read, this says so rather than guessing: a made-up figure
 * would have someone deleting recordings they did not need to.
 */
export function PenStorageBar(props: {
  totalBytes: number | null;
  freeBytes: number | null;
  bookSizes: readonly number[];
  recordingSizes: readonly number[];
}) {
  const { t, i18n } = useTranslation('common');
  const locale = i18n.language;
  const storage = penStorage(props);

  if (!storage) return <p className="hint">{t('penStorage.unreadable')}</p>;

  const usedPercent = Math.min(100, Math.round((storage.usedBytes / storage.totalBytes) * 100));

  return (
    <div className="pen-storage">
      <p>
        {t('penStorage.summary', {
          used: formatGb(storage.usedBytes, locale),
          total: formatGb(storage.totalBytes, locale),
        })}
      </p>
      <div className="pen-storage__bar" role="presentation">
        <div className="pen-storage__fill" style={{ width: `${usedPercent}%` }} />
      </div>
      <p className="hint">
        {t('penStorage.breakdown', {
          books: formatSpace(storage.bookBytes, locale),
          recordings: formatSpace(storage.recordingBytes, locale),
          free: formatSpace(storage.freeBytes, locale),
        })}
      </p>
    </div>
  );
}
