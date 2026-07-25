import { describe, it, expect } from 'vitest';
import {
  emitValue,
  isValueGroupArray,
  makeDimension,
  makeKeyword,
  makeList,
  makeQuoted
} from '@jesscss/core/value';
import type { Fn, FnCtx, List, ValueGroup } from '@jesscss/core/value';
import format, { format as stringFormat, formatPercent } from '../format.js';
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

describe('format() / %()', () => {
  it('keeps the canonical typed registration and public percent callable identity', () => {
    expect(format).toBe(formatPercent);
    expect(format.name).toBe('%');
    expect(format.variadic).toBe(true);
    expect(stringFormat.name).toBe('string-format');
    expect(lessFns.find(fn => fn.name === '%')).toBe(formatPercent);
    expect(lessFns.find(fn => fn.name === 'string-format')).toBe(stringFormat);
  });

  it('formats quoted templates and preserves quote style', async () => {
    const result = quotedValue(await call(
      format,
      makeQuoted('/users/%S?name=%s%%', '\'', false),
      makeQuoted('a b', '"', false),
      makeQuoted('x y', '"', false)
    ));
    expect(result.value).toBe('/users/a%20b?name=x y%');
    expect(result.quote).toBe('\'');
  });

  it('returns a keyword for non-quoted templates', async () => {
    const result = await call(
      format,
      makeKeyword('value=%d'),
      makeDimension(12, 'px')
    );
    expect(isValueGroupArray(result)).toBe(false);
    if (isValueGroupArray(result) || result.type !== 'Keyword') {
      throw new TypeError('Expected a keyword value.');
    }
    expect(result.text).toBe('value=12px');
  });

  it('keeps CSS-form quotes for %a/%d and strips them only for %s', async () => {
    const cssArgument = makeQuoted('x y', '"', false);
    const percentA = quotedValue(await call(format, makeQuoted('%a', '"', false), cssArgument));
    const percentD = quotedValue(await call(format, makeQuoted('%d', '"', false), cssArgument));
    const percentS = quotedValue(await call(format, makeQuoted('%s', '"', false), cssArgument));

    expect(emitValue(percentA)).toBe('""x y""');
    expect(emitValue(percentD)).toBe('""x y""');
    expect(emitValue(percentS)).toBe('"x y"');
  });
});
