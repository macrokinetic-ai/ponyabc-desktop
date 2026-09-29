import { powerSaveBlocker } from 'electron';

/**
 * Keeps the computer awake while the pen is being written to.
 *
 * The pen's USB is 1.x — measured at about 1 MB/s — so a single book can take twenty minutes and
 * a library sync could run for hours. A machine that goes to sleep part-way through leaves a
 * half-written file on a FAT volume, which is the one outcome none of the app's other guards can
 * undo afterwards.
 *
 * `prevent-app-suspension` rather than `prevent-display-sleep`: the screen is welcome to turn
 * off, and keeping a nursery laptop's display lit for twenty minutes would be its own rudeness.
 *
 * Returns the release function. Call it in a `finally` — a blocker left running would quietly
 * stop the machine sleeping for the rest of the session.
 */
export function blockSleepDuringPenWrite(reason: string): () => void {
  let id: number | null = null;
  try {
    id = powerSaveBlocker.start('prevent-app-suspension');
  } catch {
    // Not available (headless, tests, an OS that refuses) — never a reason to refuse the write.
    return () => {};
  }

  let released = false;
  return () => {
    if (released || id === null) return;
    released = true;
    try {
      if (powerSaveBlocker.isStarted(id)) powerSaveBlocker.stop(id);
    } catch {
      // Nothing useful to do; the blocker dies with the process at worst.
    }
    void reason;
  };
}
