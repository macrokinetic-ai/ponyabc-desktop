/**
 * Exclusive right to write/remove files on the currently connected pen, shared across BOOK
 * and DIY. Only the final cache/source-to-pen write or delete step acquires this — browsing
 * the catalog and downloading into the computer-side cache never do, so those stay fully
 * concurrent with everything else. Standard promise-chain mutex: each acquire appends to a
 * tail promise and only resolves once every earlier holder has released.
 */
let tail: Promise<void> = Promise.resolve();

export function acquirePenLock(): Promise<() => void> {
  let release!: () => void;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  const acquired = tail.then(() => release);
  tail = tail.then(() => released);
  return acquired;
}
