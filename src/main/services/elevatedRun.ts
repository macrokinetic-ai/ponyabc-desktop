import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { parseChcpOutput } from './logEncoding';

/**
 * Runs an executable elevated (UAC) on Windows and gives the caller BOTH a real, live-updating
 * log and a real exit code — a real problem on Windows, not a formality: `child_process.spawn`
 * has no "runas" verb at all (it wraps CreateProcess, not ShellExecuteEx), and PowerShell's own
 * `Start-Process -Verb RunAs` explicitly forbids combining `-Verb` with
 * `-RedirectStandardOutput`/`-RedirectStandardError` — Microsoft's own docs say so. So an
 * elevated child's output can never be piped straight back to us the ordinary way.
 *
 * The workaround used here, in two layers:
 *   1. A tiny generated .bat does the actual redirection ITSELF, from inside the elevated
 *      process, to a plain log file: `"exe" args... > log.txt 2>&1`. Redirection inside the
 *      elevated process is fine — only the .NET Process-class redirection properties are
 *      blocked when paired with -Verb.
 *   2. A tiny generated .ps1 elevates that ONE .bat via `Start-Process -Verb RunAs -Wait
 *      -PassThru`, so we get a real exit code back (`$p.ExitCode`) once it returns, and a
 *      `catch` block that specifically recognizes the user clicking "No" (Win32 error 1223,
 *      ERROR_CANCELLED — ShellExecute's own signal for a declined elevation prompt) as a
 *      distinct outcome from any other launch failure.
 *
 * We spawn the .ps1 UNELEVATED (a plain spawn — no UAC needed to run powershell.exe itself);
 * the UAC prompt only appears for the inner .bat. While that runs, we poll the log file
 * ourselves (this process never gets piped output, so polling a plain file is the only way to
 * see progress as it happens) and hand incremental text to the caller.
 *
 * Deliberately has no kill/cancel method: once a flash has actually started, force-terminating
 * the wrapper here does not — and must not be assumed to — stop the real elevated child (it
 * runs in a different, elevated process tree; killing our own unelevated spawn() just abandons
 * our OWN wait for it). A caller that gives up waiting gets `{status:'timeout'}`, never a
 * forced kill — see runElevated's `timeoutMs`.
 */

export interface BuildFlashBatchParams {
  exePath: string;
  args: string[];
  cwd: string;
  logFilePath: string;
  /** Where the REAL active console/OEM codepage (captured via `chcp` at the moment this batch
   *  actually runs, never assumed) gets written — see logEncoding.ts's parseChcpOutput/
   *  decodeLogBytes, which use this to correctly decode the vendor tool's Chinese console output
   *  instead of blindly assuming UTF-8. */
  codepageFilePath: string;
}

/** Quotes a single batch-file argument — always quotes (simpler and safe even for args with no
 *  spaces) and escapes any embedded `"` as `""`, the batch-file convention. */
function quoteBatchArg(arg: string): string {
  return `"${arg.replace(/"/g, '""')}"`;
}

/** Pure — no filesystem/process access, fully testable on any platform. */
export function buildFlashBatchScript(params: BuildFlashBatchParams): string {
  const { exePath, args, cwd, logFilePath, codepageFilePath } = params;
  const argsStr = args.map(quoteBatchArg).join(' ');
  return [
    '@echo off',
    // Captured FIRST, before anything else runs, so it reflects the codepage actually in effect
    // for this console session (and thus for whatever bytes the target writes to stdout) rather
    // than some later, possibly-changed state. `chcp`'s own label text is locale-dependent but
    // the trailing number is always plain ASCII digits — see parseChcpOutput.
    `chcp > ${quoteBatchArg(codepageFilePath)}`,
    `cd /d ${quoteBatchArg(cwd)}`,
    // `< nul` matters for real vendor chains, not just hygiene: the confirmed working P5 entry
    // point (tools\download.bat) ends by delegating to a nested script that finishes with a
    // bare `pause` — waiting on a keypress forever on a real interactive console. Redirecting
    // stdin from `nul` makes `pause` see immediate EOF and fall through instead of hanging,
    // which is what makes `-Wait`/exit-code capture usable at all for this exact chain. Applied
    // unconditionally since it's a no-op for any target that never reads stdin.
    `${quoteBatchArg(exePath)}${argsStr ? ' ' + argsStr : ''} < nul > ${quoteBatchArg(logFilePath)} 2>&1`,
    'exit /b %errorlevel%',
    '',
  ].join('\r\n');
}

/** Pure. `batchPath` is the ONLY thing this script hardcodes — all the real complexity (target
 *  exe, args, cwd, log path) lives in the batch file already, keeping this half of the quoting
 *  problem trivial. */
export function buildElevationPowerShellScript(batchPath: string): string {
  const psQuoted = `'${batchPath.replace(/'/g, "''")}'`;
  return [
    "$ErrorActionPreference = 'Stop'",
    'try {',
    // -WindowStyle Hidden hides the elevated console window a regular teacher never needs to
    // see — this is purely a display property of the console host and does not change
    // stdin/stdout/redirection behavior at all, so it cannot affect the `< nul` EOF-for-pause
    // mechanism in buildFlashBatchScript, or the -Wait/-PassThru exit-code contract. Verified for
    // real (not assumed) on a real Windows runner — see
    // .github/workflows/firmware-log-encoding-smoke.yml.
    `  $p = Start-Process -FilePath ${psQuoted} -Verb RunAs -WindowStyle Hidden -Wait -PassThru`,
    '  Write-Output "EXITCODE:$($p.ExitCode)"',
    '} catch {',
    '  $msg = $_.Exception.Message',
    '  $native = $null',
    '  if ($_.Exception.PSObject.Properties.Name -contains "NativeErrorCode") { $native = $_.Exception.NativeErrorCode }',
    "  if ($native -eq 1223 -or $msg -match 'cancell?ed by the user' -or $msg -match '0x80004005') {",
    '    Write-Output "DECLINED"',
    '  } else {',
    '    Write-Output "LAUNCH_ERROR:$msg"',
    '  }',
    '}',
    '',
  ].join('\r\n');
}

export type ElevationOutcome =
  | { status: 'completed'; exitCode: number }
  | { status: 'declined' }
  | { status: 'launch-error'; message: string }
  | { status: 'unparseable'; raw: string };

/** Pure. Reads the outer (unelevated) powershell.exe's own stdout — never the real target's
 *  output, which only ever goes to the polled log file. */
export function parseElevationOutput(stdout: string): ElevationOutcome {
  const trimmed = stdout.trim();
  const exitMatch = trimmed.match(/EXITCODE:(-?\d+)/);
  if (exitMatch) return { status: 'completed', exitCode: parseInt(exitMatch[1], 10) };
  if (/\bDECLINED\b/.test(trimmed)) return { status: 'declined' };
  const errMatch = trimmed.match(/LAUNCH_ERROR:(.*)/s);
  if (errMatch) return { status: 'launch-error', message: errMatch[1].trim() };
  return { status: 'unparseable', raw: trimmed };
}

/** Polls a log file for appended content from a given starting byte offset, calling `onDelta`
 *  with just the newly-appended RAW bytes each time the file has grown — deliberately never
 *  decoded to a string here. Decoding must happen later, from the FULL accumulated raw buffer
 *  (see logEncoding.ts's decodeLogBytes) once the real codepage is known, so a multi-byte
 *  character split across two poll reads is never corrupted by being decoded in isolation.
 *  Tolerant of the file not existing yet (the elevated process may take a moment to create it)
 *  and of read errors mid-poll (e.g. a transient sharing violation while the writer has it
 *  open) — both are treated as "nothing new yet", never thrown, since a flaky poll must never
 *  abort the wait for the real result. Returns a stop function; the returned promise never
 *  rejects. */
export function startLogPolling(
  logFilePath: string,
  onDelta: (deltaBytes: Buffer) => void,
  intervalMs = 400,
): { stop: () => Promise<void> } {
  let offset = 0;
  let stopped = false;
  let timer: NodeJS.Timeout | null = null;

  async function pollOnce(): Promise<void> {
    try {
      const stat = await fs.promises.stat(logFilePath);
      if (stat.size > offset) {
        const fh = await fs.promises.open(logFilePath, 'r');
        try {
          const length = stat.size - offset;
          const buf = Buffer.alloc(length);
          await fh.read(buf, 0, length, offset);
          offset = stat.size;
          onDelta(buf);
        } finally {
          await fh.close();
        }
      }
    } catch {
      // File not there yet, or a transient read error — try again next tick.
    }
  }

  function scheduleNext(): void {
    if (stopped) return;
    timer = setTimeout(async () => {
      await pollOnce();
      scheduleNext();
    }, intervalMs);
  }
  scheduleNext();

  return {
    stop: async () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      await pollOnce(); // one last read so nothing written just before stopping is lost
    },
  };
}

/** Polls for the codepage sidecar file (written once, as the very first thing run.bat does —
 *  see buildFlashBatchScript) and reports its parsed value exactly once via `onDetected`, then
 *  stops polling on its own. `onDetected` fires with `null` if the codepage file never appeared
 *  or never parsed before `stop()` is called (e.g. the elevated launch never actually started) —
 *  callers must treat that as "codepage genuinely unknown," never as "assume UTF-8." */
export function startCodepagePolling(
  codepageFilePath: string,
  onDetected: (codepage: number | null) => void,
  intervalMs = 200,
): { stop: () => void } {
  let stopped = false;
  let detected = false;
  let timer: NodeJS.Timeout | null = null;

  async function pollOnce(): Promise<void> {
    if (detected) return;
    try {
      const raw = await fs.promises.readFile(codepageFilePath, 'latin1'); // ASCII digits only — see parseChcpOutput
      const cp = parseChcpOutput(raw);
      if (cp !== null) {
        detected = true;
        onDetected(cp);
      }
    } catch {
      // Not written yet — try again next tick.
    }
  }

  function scheduleNext(): void {
    if (stopped || detected) return;
    timer = setTimeout(async () => {
      await pollOnce();
      scheduleNext();
    }, intervalMs);
  }
  scheduleNext();

  return {
    stop: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      if (!detected) onDetected(null);
    },
  };
}

export interface RunElevatedParams {
  exePath: string;
  args: string[];
  cwd: string;
  /** Directory the generated .bat/.ps1/log files are written into — caller's responsibility to
   *  use a fresh, private scratch directory (never the target exe's own install location). */
  workDir: string;
  /** Raw bytes only — never pre-decoded here. See logEncoding.ts's decodeLogBytes: the caller
   *  must accumulate these and decode the FULL accumulated buffer fresh each time, once
   *  onCodepageDetected has fired, to avoid corrupting multi-byte characters split across polls. */
  onLogUpdate?: (deltaBytes: Buffer) => void;
  /** Fires exactly once, with the real detected console/OEM codepage (or null if it could never
   *  be determined) — never assume a codepage without this firing first. */
  onCodepageDetected?: (codepage: number | null) => void;
  logPollIntervalMs?: number;
  /** If the outer wrapper hasn't finished within this long, resolve with `{status:'timeout'}`
   *  and stop watching — never kills anything. `undefined` = wait indefinitely. */
  timeoutMs?: number;
}

export type RunElevatedResult = ElevationOutcome | { status: 'timeout' } | { status: 'unsupported-platform' };

export async function runElevated(params: RunElevatedParams): Promise<RunElevatedResult> {
  if (process.platform !== 'win32') return { status: 'unsupported-platform' };

  const { exePath, args, cwd, workDir, onLogUpdate, onCodepageDetected, logPollIntervalMs, timeoutMs } = params;
  await fs.promises.mkdir(workDir, { recursive: true });
  const batchPath = path.join(workDir, 'run.bat');
  const scriptPath = path.join(workDir, 'run.ps1');
  const logFilePath = path.join(workDir, 'run.log');
  const codepageFilePath = path.join(workDir, 'codepage.txt');

  await fs.promises.writeFile(batchPath, buildFlashBatchScript({ exePath, args, cwd, logFilePath, codepageFilePath }), 'utf-8');
  await fs.promises.writeFile(scriptPath, buildElevationPowerShellScript(batchPath), 'utf-8');

  const poller = startLogPolling(logFilePath, (delta) => onLogUpdate?.(delta), logPollIntervalMs);
  const codepagePoller = startCodepagePolling(codepageFilePath, (cp) => onCodepageDetected?.(cp), logPollIntervalMs);

  return new Promise<RunElevatedResult>((resolve) => {
    let settled = false;
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath], {
      cwd: workDir,
      windowsHide: true,
    });

    let stdout = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf-8');
    });
    child.stderr?.on('data', () => {
      // The wrapper's own stderr is not part of the parsed contract (see parseElevationOutput);
      // real target failures live in the polled log file, not here.
    });

    const finish = async (result: RunElevatedResult) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      await poller.stop();
      codepagePoller.stop();
      resolve(result);
    };

    const timer = timeoutMs
      ? setTimeout(() => {
          void finish({ status: 'timeout' });
        }, timeoutMs)
      : null;

    child.on('error', (err) => {
      void finish({ status: 'launch-error', message: err.message });
    });
    child.on('close', () => {
      void finish(parseElevationOutput(stdout));
    });
  });
}
