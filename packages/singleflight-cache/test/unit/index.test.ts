import { describe, expect, it, vi } from 'vitest';
import { singleflightCache } from '../../src/index.js';

describe('singleflightCache', () => {
  it('computes and returns the value for a not-yet-cached key', async () => {
    const cache = new Map<string, Promise<number>>();
    const compute = vi.fn(async () => 42);

    const result = await singleflightCache(cache, 'a', compute);

    expect(result).toBe(42);
    expect(compute).toHaveBeenCalledTimes(1);
  });

  it('does not re-invoke compute for an already-resolved entry', async () => {
    const cache = new Map<string, Promise<number>>();
    const compute = vi.fn(async () => 1);

    await singleflightCache(cache, 'a', compute);
    await singleflightCache(cache, 'a', compute);

    expect(compute).toHaveBeenCalledTimes(1);
  });

  it('dedupes concurrent callers awaiting the same not-yet-resolved key', async () => {
    const cache = new Map<string, Promise<number>>();
    let resolve!: (value: number) => void;
    const compute = vi.fn(
      () =>
        new Promise<number>((r) => {
          resolve = r;
        }),
    );

    const first = singleflightCache(cache, 'a', compute);
    const second = singleflightCache(cache, 'a', compute);
    resolve(7);

    expect(await first).toBe(7);
    expect(await second).toBe(7);
    expect(compute).toHaveBeenCalledTimes(1);
  });

  it('evicts the entry on rejection so the next call retries', async () => {
    const cache = new Map<string, Promise<number>>();
    let calls = 0;
    const compute = async () => {
      calls += 1;
      if (calls === 1) throw new Error('transient');
      return 9;
    };

    await expect(singleflightCache(cache, 'a', compute)).rejects.toThrow('transient');
    // let the internal .catch() eviction microtask run before the next call
    await Promise.resolve();
    const result = await singleflightCache(cache, 'a', compute);

    expect(result).toBe(9);
    expect(calls).toBe(2);
  });

  it('does not evict a newer entry when a stale in-flight promise for the same key rejects after an external reset', async () => {
    const cache = new Map<string, Promise<number>>();
    let rejectFirst!: (err: Error) => void;
    const first = singleflightCache(
      cache,
      'a',
      () =>
        new Promise<number>((_resolve, reject) => {
          rejectFirst = reject;
        }),
    );
    // Simulate an external reset (e.g. a test-reset helper's cache.clear())
    // racing the still-pending first computation.
    cache.clear();
    const second = await singleflightCache(cache, 'a', async () => 99);
    expect(second).toBe(99);

    rejectFirst(new Error('late rejection'));
    await expect(first).rejects.toThrow('late rejection');
    // let the stale .catch() eviction microtask run
    await Promise.resolve();

    expect(cache.get('a')).toBeDefined();
    await expect(cache.get('a')).resolves.toBe(99);
  });

  it('keys entries independently', async () => {
    const cache = new Map<string, Promise<string>>();
    const computeA = vi.fn(async () => 'A');
    const computeB = vi.fn(async () => 'B');

    const a = await singleflightCache(cache, 'a', computeA);
    const b = await singleflightCache(cache, 'b', computeB);

    expect(a).toBe('A');
    expect(b).toBe('B');
    expect(cache.size).toBe(2);
  });
});
