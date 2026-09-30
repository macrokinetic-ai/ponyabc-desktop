import type { TFunction } from 'i18next';
import type { SnapshotReason } from '../../main/services/recordingSnapshot';

/**
 * What a backup is called in the list.
 *
 * A backup the owner asked for and a backup the app took a second before replacing something
 * are different things, and rc5 showed them identically — a date and a count, for both. Anyone
 * looking at the list had no way to tell which ones they had made on purpose.
 *
 * The automatic ones name what they were protecting where one recording was at stake, because
 * "before replacing 0451" is the only part a person needs to recognise it by.
 */
export function backupLabel(
  backup: { reason: SnapshotReason; protecting: string | null },
  t: TFunction<'recordings'>,
): string {
  const name = backup.protecting ? stickerName(backup.protecting) : null;

  switch (backup.reason) {
    case 'before-replace':
      return name ? t('backup.labelBeforeReplace', { name }) : t('backup.labelBeforeReplaceMany');
    case 'before-delete':
      return name ? t('backup.labelBeforeDelete', { name }) : t('backup.labelBeforeDeleteMany');
    case 'before-restore':
      return t('backup.labelBeforeRestore');
    case 'before-reassign':
      return name ? t('backup.labelBeforeReassign', { name }) : t('backup.labelBeforeRestore');
    case 'migration':
      return t('backup.labelMigration');
    case 'manual':
    default:
      return t('backup.labelManual');
  }
}

/** The sticker number as it is written on the sticker: no file extension. */
export function stickerName(fileName: string): string {
  return fileName.replace(/\.mp3$/i, '');
}

/** Sizes a parent can read, never bytes. */
export function formatSize(bytes: number, locale: string): string {
  if (bytes >= 1024 * 1024) return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(bytes / (1024 * 1024))} MB`;
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(Math.max(1, bytes / 1024))} KB`;
}
