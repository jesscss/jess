import { describe, it, expect } from 'vitest';
import {
  emitValue,
  isValueGroupArray,
  makeKeyword,
  makeList,
  makeQuoted
} from '@jesscss/core';
import type { Fn, FnCtx, List, ValueGroup } from '@jesscss/core';
import replace from '../replace.js';
import { lessFns } from '../registry.js';

const ctx: FnCtx = {
  modes: { unitMode: 'preserve' },
  stringify: value => !isValueGroupArray(value) && value.type === 'Quoted'
    ? value.value
    : emitValue(value)
};

function call(fn: Fn, ...args: ValueGroup[]): ValueGroup | Promise<ValueGroup> {
  return fn(makeList(args, ',') as List, ctx);
}

function quotedValue(value: ValueGroup): { readonly type: 'Quoted'; readonly value: string; readonly quote: string } {
  if (isValueGroupArray(value) || value.type !== 'Quoted') {
    throw new TypeError('Expected a quoted value.');
  }
  return value;
}

describe('replace()', () => {
  it('keeps the canonical typed registration and raw List/FnCtx contract', () => {
    expect(typeof replace).toBe('function');
    expect(replace.name).toBe('replace');
    expect(replace.variadic).toBe(true);
    expect(replace.params).toEqual([
      { type: 'any' },
      { type: 'any' },
      { type: 'any' },
      { type: 'any', optional: true }
    ]);
    expect(lessFns.find(fn => fn.name === 'replace')).toBe(replace);
  });

  it('replaces in quoted input and preserves quote style', async () => {
    const result = quotedValue(await call(
      replace,
      makeQuoted('hello', '\'', false),
      makeQuoted('l', '"', false),
      makeQuoted('x', '"', false)
    ));
    expect(result.value).toBe('hexlo');
    expect(result.quote).toBe('\'');
  });

  it('replaces with flags and returns a keyword for non-quoted input', async () => {
    const result = await call(
      replace,
      makeKeyword('Hello'),
      makeQuoted('h', '"', false),
      makeQuoted('x', '"', false),
      makeQuoted('i', '"', false)
    );
    expect(isValueGroupArray(result)).toBe(false);
    if (isValueGroupArray(result) || result.type !== 'Keyword') {
      throw new TypeError('Expected a keyword value.');
    }
    expect(result.text).toBe('xello');
  });

  it('serializes non-quoted replacement values', async () => {
    const result = await call(
      replace,
      makeKeyword('alpha-beta'),
      makeQuoted('-', '"', false),
      makeKeyword('_')
    );
    expect(isValueGroupArray(result)).toBe(false);
    if (isValueGroupArray(result) || result.type !== 'Keyword') {
      throw new TypeError('Expected a keyword value.');
    }
    expect(result.text).toBe('alpha_beta');
  });
});
