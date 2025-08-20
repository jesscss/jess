import { describe, it, expect, vi } from 'vitest';
import { pipe, safePipe, type SafePipeOptions } from '../src';

describe('pipe', () => {
  it('returns sync value when all steps are sync', () => {
    const upper = (s: string) => s.toUpperCase();
    const exclaim = (s: string) => s + '!';
    const out = pipe('ok', upper, exclaim);
    expect(out).toBe('OK!');
  });

  it('promotes to Promise when any step is async', async () => {
    const upper = (s: string) => s.toUpperCase();
    const asyncAdd = async (s: string) => s + '!';
    const out = pipe('ok', upper, asyncAdd);
    expect(out).toBeInstanceOf(Promise);
    await expect(out).resolves.toBe('OK!');
  });

  it('switches to async tail mid-pipeline and resolves correctly', async () => {
    const s1 = (s: string) => s + '1';
    const asyncStep = async (s: string) => s + '2';
    const s3 = (s: string) => s + '3';
    const out = pipe('a', s1, asyncStep, s3);
    await expect(out).resolves.toBe('a123');
  });

  it('async tail handles thenable step without wrapping (true branch in runAsync)', async () => {
    const s1 = (s: string) => s + '1';
    const a2 = async (s: string) => s + '2';
    const a3 = async (s: string) => s + '3';
    const out = pipe('a', s1, a2, a3);
    await expect(out).resolves.toBe('a123');
  });

  it('steps-only mode disambiguation works when two functions are passed (no explicit input)', () => {
    const out = pipe((x?: string) => (x ?? 'h') + 'i', (s: string) => s + '!');
    expect(out).toBe('hi!');
  });

  it('two-step disambiguation with first=fn, second=value (treated as input)', () => {
    const out = pipe(() => 'x', (s: string) => s + '!');
    expect(out).toBe('x!');
  });

  it('first is thunk and second is not a function (args.length>1 branch): evaluates thunk input then throws on bad step', () => {
    expect(() => (pipe as any)(() => 'x', undefined)).toThrow();
  });

  it('accepts initial thunk and handles sync errors by throwing', () => {
    const boom = () => {
      throw new Error('nope');
    };
    expect(() => pipe(boom, (x: unknown) => x)).toThrowError('nope');
  });

  it('works without an initial value (first step receives undefined)', () => {
    const out = pipe((x?: number) => (x ?? 2) * 3, (n: number) => n + 1);
    expect(out).toBe(7);
  });

  it('supports single function call with no explicit input', () => {
    const out = pipe((x?: string) => (x ?? 'a') + 'b');
    expect(out).toBe('ab');
  });

  it('handles Promise as initial input via async tail', async () => {
    const out = pipe(Promise.resolve('x'), (s: string) => s + 'y');
    await expect(out).resolves.toBe('xy');
  });

  it('returns undefined when called with no args', () => {
    // Deliberately calling without args to exercise branch
    const out = (pipe as any)();
    expect(out).toBeUndefined();
  });
});

describe('safePipe', () => {
  it('returns value for sync pipeline and never throws', () => {
    const out = safePipe('ok', {}, (s: string) => s.toUpperCase());
    expect(out).toBe('OK');
  });

  it('captures sync throw, calls onError once, returns fallback', () => {
    const onError = vi.fn();
    const out = safePipe('ok', { onError, fallback: 'X' }, () => {
      throw new Error('boom');
    }, (s: string) => s.toUpperCase());
    expect(onError).toHaveBeenCalledTimes(1);
    expect(out).toBe('X');
  });

  it('sync throw with onError that throws is swallowed and returns fallback', () => {
    const onError = vi.fn(() => { throw new Error('handler-fail'); });
    const out = safePipe('ok', { onError, fallback: 'X' }, () => {
      throw new Error('boom');
    });
    expect(onError).toHaveBeenCalledTimes(1);
    expect(out).toBe('X');
  });

  it('works options-first with no initial value', () => {
    const out = safePipe({ onError: vi.fn(), fallback: 0 }, (x?: number) => (x ?? 2) * 5, (n: number) => n + 1);
    expect(out).toBe(11);
  });

  it('returns undefined when no fallback is provided and an error occurs', () => {
    const onError = vi.fn();
    const out = safePipe('ok', { onError }, () => {
      throw new Error('bad');
    }, (s: string) => s.toUpperCase());
    expect(onError).toHaveBeenCalledTimes(1);
    expect(out).toBeUndefined();
  });

  it('promotes to Promise for async steps and rejects/handles appropriately', async () => {
    const asyncStep = async (s: string) => s + '!';
    const out = safePipe('ok', { onError: vi.fn() }, asyncStep, (s: string) => s + '?');
    expect(out).toBeInstanceOf(Promise);
    await expect(out).resolves.toBe('ok!?');
  });

  it('safePipe steps-only mode (options-first) when two functions passed: uses empty options', () => {
    const out = safePipe((x?: string) => (x ?? 'a') + 'b', (s: string) => s + 'c');
    expect(out).toBe('abc');
  });

  it('safePipe with input and omitted options defaults to empty options', () => {
    const out = safePipe('x', {} as SafePipeOptions<string>, (s: string) => s + '!');
    expect(out).toBe('x!');
  });

  it('handles async rejection with onError and fallback', async () => {
    const onError = vi.fn();
    const out = safePipe('ok', { onError, fallback: 'F' }, async () => {
      throw new Error('async-fail');
    }, (s: string) => s + '!');
    expect(out).toBeInstanceOf(Promise);
    await expect(out).resolves.toBe('F');
    expect(onError).toHaveBeenCalled();
  });

  it('async tail catches sync throw inside then and returns fallback', async () => {
    const onError = vi.fn();
    const out = safePipe('a', { onError, fallback: 'fb' }, async (s: string) => s + '1', () => {
      throw new Error('after-async');
    });
    await expect(out).resolves.toBe('fb');
    expect(onError).toHaveBeenCalled();
  });

  it('outer async catch handles when onError itself throws (onError errors are swallowed)', async () => {
    let calls = 0;
    const onError = vi.fn(() => {
      calls += 1;
      if (calls === 1) throw new Error('onError-fail');
    });
    const out = safePipe('x', { onError, fallback: 'Z' }, async () => {
      throw new Error('async-bang');
    });
    await expect(out).resolves.toBe('Z');
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('handles rejection returned by a sync step in async tail', async () => {
    const onError = vi.fn();
    const retRejected = () => Promise.reject(new Error('reject'));
    const out = safePipe('x', { onError, fallback: 'Y' }, async (s: string) => s + '1', () => retRejected());
    await expect(out).resolves.toBe('Y');
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('uses async tail immediately when initial input is a Promise', async () => {
    const out = safePipe(Promise.resolve('a'), { onError: vi.fn() }, (s: string) => s + '1', async (s: string) => s + '2');
    await expect(out).resolves.toBe('a12');
  });

  it('returns undefined if called with no args', () => {
    // Deliberately calling without args to exercise branch
    const out = (safePipe as any)();
    expect(out).toBeUndefined();
  });

  it('supports fallback as a thunk', () => {
    const onError = vi.fn();
    const out = safePipe('ok', { onError, fallback: () => 'Z' }, () => {
      throw new Error('boom');
    });
    expect(onError).toHaveBeenCalledTimes(1);
    expect(out).toBe('Z');
  });

  it('handles initial thunk that throws (sync) and returns fallback', () => {
    const onError = vi.fn();
    const init = () => { throw new Error('init-fail'); };
    const out = safePipe(init, { onError, fallback: 'FB' }, (x: unknown) => x);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(out).toBe('FB');
  });

  it('initial thunk throws and onError throws is swallowed; fallback returned', () => {
    const onError = vi.fn(() => { throw new Error('onError-fail'); });
    const init = () => { throw new Error('init-fail'); };
    const out = safePipe(init, { onError, fallback: 'FB' }, (x: unknown) => x);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(out).toBe('FB');
  });
});


