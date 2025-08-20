import { describe, it, expect, vi } from 'vitest';
import { pipe, safePipe, tryStep, guard, isThenable, isPromise } from '../src';

describe('tryStep', () => {
  it('captures sync throw and returns fallback', () => {
    const step = tryStep(() => { throw new Error('boom'); }, { fallback: 'X' });
    const out = pipe('ok', step);
    expect(out).toBe('X');
  });

  it('captures async reject and returns fallback', async () => {
    const step = tryStep(async () => { throw new Error('bad'); }, { fallback: 'Y' });
    const out = pipe('a', step);
    await expect(out).resolves.toBe('Y');
  });

  it('captures async reject, calls onError, returns fallback', async () => {
    const onError = vi.fn();
    const step = tryStep(async () => { throw new Error('oops'); }, { onError, fallback: 'Z' });
    const out = pipe('inp', step);
    await expect(out).resolves.toBe('Z');
    expect(onError).toHaveBeenCalledWith(expect.any(Error), 'inp');
  });

  it('captures async reject, onError throws (swallowed), returns fallback', async () => {
    const onError = vi.fn(() => { throw new Error('handler-fail'); });
    const step = tryStep(async () => { throw new Error('boom'); }, { onError, fallback: 'ZZ' });
    const out = pipe('v', step);
    await expect(out).resolves.toBe('ZZ');
    expect(onError).toHaveBeenCalledWith(expect.any(Error), 'v');
  });

  it('calls onError with input and swallows its errors', () => {
    const onError = vi.fn(() => { throw new Error('handler-fail'); });
    const step = tryStep((n: number) => { throw new Error('no'); }, { onError, fallback: 0 });
    const out = pipe(5, step);
    expect(out).toBe(0);
    expect(onError).toHaveBeenCalledWith(expect.any(Error), 5);
  });

  it('rethrows when configured', () => {
    const step = tryStep(() => { throw new Error('boom'); }, { rethrow: true });
    expect(() => pipe('ok', step as any)).toThrowError('boom');
  });

  it('rethrows when configured (async)', async () => {
    const step = tryStep(async () => { throw new Error('A'); }, { rethrow: true });
    const out = pipe('ok', step);
    await expect(out).rejects.toThrowError('A');
  });

  it('passes through value without error (sync and async)', async () => {
    const syncStep = tryStep((n: number) => n * 2);
    expect(pipe(2, syncStep)).toBe(4);

    const asyncStep = tryStep(async (s: string) => s + '!');
    const out = pipe('hi', asyncStep);
    await expect(out).resolves.toBe('hi!');
  });

  it('supports fallback as a function receiving error and input (sync and async)', async () => {
    const fbSync = vi.fn((e: unknown, n: number) => `fb:${String((e as Error).message)}:${n}`);
    const stepSync = tryStep((n: number) => { throw new Error('oops'); }, { fallback: fbSync });
    const outSync = pipe(7, stepSync);
    expect(outSync).toBe('fb:oops:7');
    expect(fbSync).toHaveBeenCalledWith(expect.any(Error), 7);

    const fbAsync = vi.fn((e: unknown, s: string) => `fb:${String((e as Error).message)}:${s}`);
    const stepAsync = tryStep(async () => { throw new Error('bad'); }, { fallback: fbAsync });
    const outAsync = pipe('z', stepAsync);
    await expect(outAsync).resolves.toBe('fb:bad:z');
    expect(fbAsync).toHaveBeenCalledWith(expect.any(Error), 'z');
  });
});

describe('guard', () => {
  it('passes value through when predicate is true', () => {
    const step = guard((n: number) => n > 0);
    const out = pipe(1, step);
    expect(out).toBe(1);
  });

  it('exports isThenable and isPromise with expected behavior', async () => {
    expect(isThenable(Promise.resolve(1))).toBe(true);
    expect(isPromise(Promise.resolve(1))).toBe(true);
    const thenable = { then: () => {}, catch: undefined } as any;
    expect(isThenable(thenable)).toBe(true);
    expect(isPromise(thenable)).toBe(false);
    expect(isThenable(1)).toBe(false);
    expect(isPromise(1)).toBe(false);
  });

  it('throws when predicate is false', () => {
    const step = guard((n: number) => n > 0, (n) => new Error(`bad:${n}`));
    expect(() => pipe(-1, step)).toThrowError('bad:-1');
  });

  it('supports async predicate', async () => {
    const step = guard(async (s: string) => s.length > 1, (s) => new Error(`short:${s}`));
    const ok = pipe('hi', step);
    await expect(ok).resolves.toBe('hi');

    const bad = pipe('x', step);
    await expect(bad).rejects.toThrowError('short:x');
  });

  it('default error factory message is used when predicate fails and none provided', () => {
    const step = guard((x: number) => x > 10);
    expect(() => pipe(1, step)).toThrowError('ensure failed');
  });
});


