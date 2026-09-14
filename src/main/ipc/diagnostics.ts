import fs from 'node:fs';
import { dialog, type BrowserWindow } from 'electron';
import type { DiagnosticsExportResult, DiagnosticsSummary } from '@shared/types';
import { getAppInfo } from './appInfo';
import { appendDiagnostic, redactText } from '../services/diagnostics';
import { diagnosticsStore } from './book';

export function getDiagnosticsSummary(): DiagnosticsSummary {
  const info = getAppInfo();
  return { appVersion: info.version, platform: info.platform, arch: info.arch, entries: diagnosticsStore().get() };
}

/** The user picks the save location via a native dialog; nothing is auto-uploaded. The same
 *  redaction pass used at insert time is re-applied here (belt-and-suspenders) so every export
 *  path is guaranteed to go through the same filter. This exports diagnostic metadata only —
 *  it is not a general AXB/recording export path and never touches those files. */
export async function exportDiagnostics(window: BrowserWindow): Promise<DiagnosticsExportResult> {
  const summary = getDiagnosticsSummary();
  const { canceled, filePath } = await dialog.showSaveDialog(window, {
    title: 'Export Diagnostics',
    defaultPath: `ponyabc-diagnostics-${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
    filters: [{ name: 'JSON', extensions: ['json'] }],
  });
  if (canceled || !filePath) return { status: 'cancelled' };

  const redacted = JSON.parse(redactText(JSON.stringify(summary))) as DiagnosticsSummary;
  try {
    fs.writeFileSync(filePath, JSON.stringify(redacted, null, 2), 'utf-8');
    return { status: 'ok', path: filePath };
  } catch (err) {
    return { status: 'error', message: err instanceof Error ? err.message : String(err) };
  }
}

export function logAppStart(): void {
  const info = getAppInfo();
  appendDiagnostic(diagnosticsStore(), 'app-start', { appVersion: info.version, platform: info.platform, arch: info.arch });
}
