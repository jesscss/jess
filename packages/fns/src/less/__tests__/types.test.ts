import { describe, it, expect } from 'vitest';
import { emitValue, isValueGroupArray, makeColorRgb, makeDimension, makeKeyword, makeList, makeQuoted, HEX } from '@jesscss/core';
import type { Fn, FnCtx, UrlValue, ValueGroup } from '@jesscss/core';
import {
  iscolor,
  isem,
  iskeyword,
  isnumber,
  ispercentage,
  ispixel,
  isstring,
  isurl,
  isunit
} from '../types.js';

describe('types()', () => {
  it('checks node categories and units', () => {
    const quoted = makeQuoted('hello', '"', false);
    const keyword = makeKeyword('screen');
    const px = makeDimension(3, 'px');
    const em = makeDimension(3, 'em');
    const pct = makeDimension(3, '%');
    const color = makeColorRgb([255, 0, 0], 1, HEX);
    const url: UrlValue = { type: 'Url', bytes: 'url("test.png")' };
    const context: FnCtx = { modes: { unitMode: 'preserve' }, stringify: emitValue };

    expect(bool(iscolor, [color], context)).toBe(true);
    expect(bool(isnumber, [px], context)).toBe(true);
    expect(bool(isstring, [quoted], context)).toBe(true);
    expect(bool(iskeyword, [keyword], context)).toBe(true);
    expect(bool(iskeyword, [url], context)).toBe(false);
    expect(bool(isurl, [url], context)).toBe(true);
    expect(bool(isurl, [makeKeyword('url("test.png")')], context)).toBe(false);
    expect(bool(ispixel, [px], context)).toBe(true);
    expect(bool(ispercentage, [pct], context)).toBe(true);
    expect(bool(isem, [em], context)).toBe(true);
    expect(bool(isunit, [px, makeQuoted('PX', '"', false)], context)).toBe(true);
    expect(bool(isunit, [px, makeQuoted('em', '"', false)], context)).toBe(false);
    expect(bool(isunit, [keyword, makeQuoted('px', '"', false)], context)).toBe(false);
  });

  it('treats a nested raw space group as one non-scalar argument', () => {
    const context: FnCtx = { modes: { unitMode: 'preserve' }, stringify: emitValue };
    const group = [makeDimension(1, 'px'), makeDimension(2, 'px')];

    expect(bool(iscolor, [group], context)).toBe(false);
    expect(bool(isnumber, [group], context)).toBe(false);
    expect(bool(isstring, [group], context)).toBe(false);
    expect(bool(iskeyword, [group], context)).toBe(false);
    expect(bool(isurl, [group], context)).toBe(false);
    expect(bool(ispixel, [group], context)).toBe(false);
    expect(bool(isunit, [group, makeKeyword('px')], context)).toBe(false);
  });
});

function bool(fn: Fn, args: readonly ValueGroup[], context: FnCtx): boolean {
  const result = fn(args, context);
  if (result instanceof Promise || isValueGroupArray(result) || result.type !== 'Bool') {
    throw new TypeError('Expected a synchronous Bool result.');
  }
  return result.value;
}
