import { describe, expect, it } from 'vitest';
import { acquirePenLock } from '../../src/main/services/penOperationLock';

describe('acquirePenLock', () => {
  it('resolves immediately when nothing else holds the lock', async () => {
    const release = await acquirePenLock();
    expect(typeof release).toBe('function');
    release();
  });

  it('a second acquire waits until the first is released', async () => {
    const order: string[] = [];
    const release1 = await acquirePenLock();
    order.push('acquired-1');

    const second = acquirePenLock().then((release2) => {
      order.push('acquired-2');
      release2();
    });

    // Give the event loop a chance to prove the second acquire is still pending.
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(order).toEqual(['acquired-1']);

    order.push('releasing-1');
    release1();
    await second;
    expect(order).toEqual(['acquired-1', 'releasing-1', 'acquired-2']);
  });

  it('serializes three concurrent acquirers in request order', async () => {
    const order: number[] = [];
    async function run(n: number) {
      const release = await acquirePenLock();
      order.push(n);
      await new Promise((resolve) => setTimeout(resolve, 5));
      release();
    }
    await Promise.all([run(1), run(2), run(3)]);
    expect(order).toEqual([1, 2, 3]);
  });
});
