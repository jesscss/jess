import { describe, it, expect, vi } from 'vitest';
import { afterSettled, combineAll, mapMaybe } from '../src/index.js';

describe('mapMaybe', () => {
  it('maps a value synchronously, calling f once', () => {
    const f = vi.fn((n: number) => n + 1);
    expect(mapMaybe(2, f)).toBe(3);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('maps a promise after it resolves', async () => {
    const out = mapMaybe(Promise.resolve(2), n => n + 1);
    expect(out).toBeInstanceOf(Promise);
    await expect(out).resolves.toBe(3);
  });
});

describe('combineAll', () => {
  it('hands the same array to f, once, when no element is a promise', () => {
    const arr = [1, 2];
    const f = vi.fn((ts: number[]) => ts);
    expect(combineAll(arr, f)).toBe(arr);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('waits for every element when one is a promise', async () => {
    const out = combineAll([1, Promise.resolve(2)], ts => ts.join(','));
    expect(out).toBeInstanceOf(Promise);
    await expect(out).resolves.toBe('1,2');
  });
});

describe('afterSettled', () => {
  it('restores after a synchronous return, before returning', () => {
    const log: string[] = [];
    const run = (): number => {
      log.push('run');
      return 1;
    };
    expect(afterSettled(run, () => log.push('restore'))).toBe(1);
    expect(log).toEqual(['run', 'restore']);
  });

  it('restores after a synchronous throw', () => {
    const log: string[] = [];
    const run = (): never => {
      throw new Error('boom');
    };
    expect(() => afterSettled(run, () => log.push('restore'))).toThrow('boom');
    expect(log).toEqual(['restore']);
  });

  it('restores only once a promise resolves', async () => {
    const log: string[] = [];
    const out = afterSettled(() => Promise.resolve(1), () => log.push('restore'));
    expect(log).toEqual([]);
    await expect(out).resolves.toBe(1);
    expect(log).toEqual(['restore']);
  });

  it('restores once a promise rejects, and keeps the rejection', async () => {
    const log: string[] = [];
    const out = afterSettled(() => Promise.reject(new Error('bad')), () => log.push('restore'));
    await expect(out).rejects.toThrow('bad');
    expect(log).toEqual(['restore']);
  });
});
