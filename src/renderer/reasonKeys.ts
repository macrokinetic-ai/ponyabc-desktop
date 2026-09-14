import type { CopyFailureReason } from '@shared/types';

export const REASON_KEY: Record<CopyFailureReason, string> = {
  'not-found': 'reasonNotFound',
  permission: 'reasonPermission',
  'no-space': 'reasonNoSpace',
  'io-error': 'reasonIoError',
  disconnected: 'reasonDisconnected',
  'security-rejected': 'reasonSecurityRejected',
  'hash-mismatch': 'reasonHashMismatch',
  'backup-failed': 'reasonBackupFailed',
  other: 'reasonOther',
};
