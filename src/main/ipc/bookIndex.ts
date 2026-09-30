import path from 'node:path';
import { app } from 'electron';
import { resolvePenRoot } from '../services/pathSecurity';
import * as session from '../services/session';
import { createJsonStore } from '../services/bookStore';
import { appendDiagnostic } from '../services/diagnostics';
import type { DiagnosticEntry } from '@shared/types';
import { checkBookIndexHealth, cleanMacSidecars, resetBookIndex, type BookIndexHealth } from '../services/bookIndexReset';
import { ejectPen } from '../services/penEject';

/**
 * Deciding when the pen's book index has to be thrown away, and making sure it actually is.
 *
 * The rule (see bookIndexReset.ts for why): writing or removing a book invalidates the index —
 * an addition, a replacement under the same name, a reinstall, all of them — and a batch that
 * wrote or removed anything gets exactly one reset at the end. A batch that wrote nothing gets
 * nothing.
 *
 * Two things make this survive reality rather than only the happy path:
 *
 * 1. The "this pen needs a reset" flag is **persisted the moment the first write or remove
 *    succeeds**, not when the batch finishes. If the app is closed, crashes or loses the pen
 *    half-way through, the flag is already on disk and the next connection finishes the job.
 * 2. The reset is the **last** step, after every book operation has succeeded. Deleting the
 *    index first would leave a window where the pen has neither a valid index nor the books the
 *    new one should describe.
 * 3. **Committing the reset is this module's job, not the caller's.** It used to be the screen's:
 *    only `BookLibraryScreen.runSync` called `commitBookIndexReset`, so Re-download, Add,
 *    Replace, Remove and Restore each marked the pen stale and then left both .BIN files sitting
 *    on it until the pen was next plugged in — with no restart asked for, because nothing knew a
 *    reset had been owed. Now a pen mutation outside a batch commits as it finishes, and a batch
 *    is an explicit session that commits once when it closes. A new writing path gets the rule
 *    for free; forgetting to call something is no longer a way to break it.
 */

/** Same derivation as the BOOK verification index and the recordings labels, so one pen has one
 *  identity across every feature. */
function penKeyFor(realPath: string): string {
  return path.basename(realPath) || realPath;
}

interface PendingResets {
  /** penKey -> when the reset became necessary. */
  [penKey: string]: { requestedAtMs: number };
}

// Built here rather than imported from ./book: book.ts calls markBookIndexStale(), so importing
// its store back would make the two modules circular for the sake of one file path.
const diagnosticsStore = () => createJsonStore<DiagnosticEntry[]>(path.join(app.getPath('userData'), 'diagnostics.json'), () => []);

let pendingStore: ReturnType<typeof createJsonStore<PendingResets>> | null = null;
function pending() {
  pendingStore ??= createJsonStore<PendingResets>(path.join(app.getPath('userData'), 'bookIndexResetPending.json'), () => ({}));
  return pendingStore;
}

function resolvePen(): { ok: true; realPath: string; bookDirReal: string; penKey: string } | { ok: false } {
  const penRoot = session.getPenRoot();
  if (!penRoot) return { ok: false };
  const fresh = resolvePenRoot(penRoot.realPath);
  if (fresh.status !== 'ok') {
    if (fresh.status === 'not-found') session.setPenRoot(null);
    return { ok: false };
  }
  session.setPenRoot(fresh);
  return { ok: true, realPath: fresh.realPath, bookDirReal: fresh.bookDirReal, penKey: penKeyFor(fresh.realPath) };
}

/**
 * Records that the connected pen's index no longer describes its books. Called as soon as a
 * write or a remove succeeds — before the batch is over, so an interrupted batch still heals.
 */
export function markBookIndexStale(reason: 'written' | 'removed'): void {
  const pen = resolvePen();
  if (!pen.ok) return;
  const current = pending().get();
  if (current[pen.penKey]) return; // already pending; keep the original timestamp
  pending().set({ ...current, [pen.penKey]: { requestedAtMs: Date.now() } });
  appendDiagnostic(diagnosticsStore(), 'book-index-reset', { event: 'marked-stale', reason, pen: pen.penKey });
}

/**
 * An open batch means "more writes are coming — do not reset yet".
 *
 * Depth-counted rather than a boolean so nesting cannot end the batch early, and deliberately
 * only in memory: if the app dies with a batch open, the persisted stale flag is what heals the
 * pen on its next connection, which is the same path an interrupted batch has always taken.
 */
let openBatchDepth = 0;

export function beginPenBookBatch(): void {
  openBatchDepth += 1;
}

/** Closes a batch and, if it is the outermost one, settles whatever the batch owes the pen. */
export async function endPenBookBatch(params: { writtenFileNames?: string[] } = {}): Promise<BookIndexCommitResult> {
  openBatchDepth = Math.max(0, openBatchDepth - 1);
  if (openBatchDepth > 0) return { status: 'not-needed' };
  return commitBookIndexReset(params);
}

export function isPenBookBatchOpen(): boolean {
  return openBatchDepth > 0;
}

/**
 * Called by every pen mutation as it finishes — one write, one removal, one restore.
 *
 * Inside a batch this does nothing, because the batch will settle it. On its own, a single
 * action IS the whole batch, so the index is reset here and the caller is told, which is how the
 * screen knows to ask for the restart.
 */
export async function finishPenBookMutation(params: { writtenFileNames?: string[] } = {}): Promise<BookIndexCommitResult> {
  if (openBatchDepth > 0) return { status: 'not-needed' };
  return commitBookIndexReset(params);
}

export function isBookIndexStale(): boolean {
  const pen = resolvePen();
  return pen.ok && pending().get()[pen.penKey] !== undefined;
}

export type BookIndexCommitResult =
  /** Nothing had changed the pen's book positions, so nothing was done. */
  | { status: 'not-needed' }
  | { status: 'no-pen-selected' }
  /** The index is gone; the pen rebuilds it on its next power-on. */
  | { status: 'reset'; deleted: string[]; ejected: boolean }
  /** The reset could not be done now. It stays pending and is retried on the next connection. */
  | { status: 'still-pending'; reason: string };

/**
 * Finishes a batch: deletes the index if anything was written or removed, tidies up after macOS,
 * and ejects so the customer can unplug straight away.
 *
 * `writtenFileNames` scopes the macOS cleanup to files this batch actually wrote — everything
 * else in BOOK/ belongs to the customer.
 */
export async function commitBookIndexReset(params: { writtenFileNames?: string[] } = {}): Promise<BookIndexCommitResult> {
  const pen = resolvePen();
  if (!pen.ok) return { status: 'no-pen-selected' };
  if (!pending().get()[pen.penKey]) return { status: 'not-needed' };

  if (process.platform === 'darwin') cleanMacSidecars(pen.bookDirReal, params.writtenFileNames ?? []);

  const outcome = resetBookIndex(pen.realPath);
  appendDiagnostic(diagnosticsStore(), 'book-index-reset', {
    event: outcome.ok ? 'reset' : 'reset-failed',
    pen: pen.penKey,
    summary: outcome.summary,
  });

  if (!outcome.ok) {
    // Left pending on purpose. The books are correct on the pen; only the index is stale, and
    // the next connection fixes it without the customer having to know any of this happened.
    return { status: 'still-pending', reason: outcome.reason };
  }

  const remaining = { ...pending().get() };
  delete remaining[pen.penKey];
  pending().set(remaining);

  // Best effort, and never a failure: the customer is being told to unplug anyway, and on
  // Windows there is no reliable way to do this without administrator rights.
  const ejected = await ejectPen(pen.realPath);
  return { status: 'reset', deleted: outcome.deleted, ejected };
}

/**
 * Runs on connection. A reset WE already decided on is completed silently — the decision was
 * made when the customer synced or removed a book, and asking again would be asking them to
 * confirm something they already did.
 */
export async function completePendingBookIndexReset(): Promise<BookIndexCommitResult> {
  if (!isBookIndexStale()) return { status: 'not-needed' };
  return commitBookIndexReset();
}

export interface BookIndexStatus extends BookIndexHealth {
  /** True when a reset we already owe this pen has not been carried out yet. */
  resetPending: boolean;
}

/**
 * What the UI needs to decide whether to offer "Fix my pen's book list".
 *
 * A mismatch is never fixed silently: the app did not cause it — a parent dragging a book in or
 * out with Explorer or Finder did — so it is their pen and their decision, and the fix asks them
 * to restart it afterwards.
 */
export function getBookIndexStatus(): BookIndexStatus | { status: 'no-pen-selected' } {
  const pen = resolvePen();
  if (!pen.ok) return { status: 'no-pen-selected' };
  return { ...checkBookIndexHealth(pen.realPath), resetPending: isBookIndexStale() };
}

/** The explicit "Fix my pen's book list" action. */
export async function fixBookIndex(): Promise<BookIndexCommitResult> {
  const pen = resolvePen();
  if (!pen.ok) return { status: 'no-pen-selected' };
  // Mark first, so that a failure here is retried on the next connection exactly like any other
  // owed reset rather than being forgotten the moment the window closes.
  const current = pending().get();
  if (!current[pen.penKey]) pending().set({ ...current, [pen.penKey]: { requestedAtMs: Date.now() } });
  return commitBookIndexReset();
}

/** The firmware upgrade deletes the same two files, so it settles any reset we owed. */
export function noteFirmwareClearedBookIndex(): void {
  const pen = resolvePen();
  if (!pen.ok) return;
  const remaining = { ...pending().get() };
  if (remaining[pen.penKey] === undefined) return;
  delete remaining[pen.penKey];
  pending().set(remaining);
  appendDiagnostic(diagnosticsStore(), 'book-index-reset', { event: 'settled-by-firmware', pen: pen.penKey });
}
