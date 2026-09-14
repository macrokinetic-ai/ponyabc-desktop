import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolvePenRoot } from '../../src/main/services/pathSecurity';
import * as session from '../../src/main/services/session';

let dirs: string[] = [];

function mkPenDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ponyabc-session-pen-'));
  fs.mkdirSync(path.join(dir, 'BOOK'));
  fs.mkdirSync(path.join(dir, 'DIY'));
  dirs.push(dir);
  return dir;
}

beforeEach(() => {
  session.setPenRoot(null);
});

afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function resolvedOk(root: string) {
  const r = resolvePenRoot(root);
  if (r.status !== 'ok') throw new Error('fixture invalid');
  return r;
}

describe('session pen-root generation tracking', () => {
  it('bumps generation on the first selection (null -> connected)', () => {
    const before = session.getGeneration();
    const { changed } = session.setPenRoot(resolvedOk(mkPenDir()));
    expect(changed).toBe(true);
    expect(session.getGeneration()).toBe(before + 1);
  });

  it('does NOT bump generation on a no-op refresh of the same still-connected pen', () => {
    const pen = mkPenDir();
    session.setPenRoot(resolvedOk(pen));
    const generationAfterFirst = session.getGeneration();

    // Re-resolve and re-set with the identical path, simulating a routine re-validation.
    const { changed } = session.setPenRoot(resolvedOk(pen));
    expect(changed).toBe(false);
    expect(session.getGeneration()).toBe(generationAfterFirst);
  });

  it('bumps generation when switching to a different pen', () => {
    session.setPenRoot(resolvedOk(mkPenDir()));
    const afterFirst = session.getGeneration();
    session.setPenRoot(resolvedOk(mkPenDir()));
    expect(session.getGeneration()).toBeGreaterThan(afterFirst);
  });

  it('bumps generation on disconnect (connected -> null)', () => {
    session.setPenRoot(resolvedOk(mkPenDir()));
    const afterConnect = session.getGeneration();
    const { changed } = session.setPenRoot(null);
    expect(changed).toBe(true);
    expect(session.getGeneration()).toBeGreaterThan(afterConnect);
  });
});
