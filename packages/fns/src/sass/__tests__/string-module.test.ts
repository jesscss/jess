import { describe, expect, it } from 'vitest';
import { emitValue, makeDimension, makeKeyword, makeList, makeQuoted, serializeValue, type Fn, type ValueGroup } from '@jesscss/core';
import * as sassGlobals from '../index.js';
import { sassFns } from '../registry.js';
import * as stringModule from '../string/index.js';
import * as stringGlobals from '../string/globals.js';

/**
 * `sass:string` on the value domain.
 *
 * Expectations are taken from the sass-spec conformance corpus
 * (`sass-spec@f282e38`, `spec/core_functions/string/**` and
 * `spec/core_functions/global/string.hrx`), not from hand-picked examples. The
 * corpus is authored against `@use "sass:string"`, which the SCSS parser cannot
 * yet parse, so the cases are exercised here against the same bodies through
 * the evaluator's `(ValueGroup, FnCtx)` route.
 *
 * Cases the corpus has that this suite deliberately does NOT assert, because
 * they are decided outside these bodies:
 *  - every `error/*` case: a body that throws is currently preserved verbatim by
 *    the evaluator's lenient function mode, and `too_many_args` never reaches a
 *    body at all (extra positional args are dropped before the arity check).
 *  - `@charset "UTF-8"` emission for non-ASCII output.
 *  - CSS escape sequences inside a string payload (`"\E000"`, `"c\0308"`):
 *    `Quoted.value` carries the RAW authored bytes, so a code-point count sees
 *    the escape's characters. Decoding belongs to the parser, not here.
 */

const ctx = { modes: { unitMode: 'preserve' as const }, stringify: (value: ValueGroup) => emitValue(value) };

function call(fn: Fn, ...args: ValueGroup[]): ValueGroup {
  const result = fn(makeList(args, ','), ctx);
  if (result === undefined || result instanceof Promise) {
    throw new TypeError('Expected a synchronous Sass string result.');
  }
  return result;
}

const bytes = (fn: Fn, ...args: ValueGroup[]): string => serializeValue(call(fn, ...args));
const q = (value: string, quote = '"'): ValueGroup => makeQuoted(value, quote, false);
const k = makeKeyword;
const n = makeDimension;

const { length, quote, unquote, toUpperCase, toLowerCase, index, slice, insert, uniqueId } = stringModule;

describe('sass:string — quote / unquote', () => {
  it('adds quotes, normalizing the quote character the way dart-sass does', () => {
    expect(bytes(quote, k('c'))).toBe('"c"');
    expect(bytes(quote, q('c'))).toBe('"c"');
    expect(bytes(quote, q('c', '\''))).toBe('"c"');
    expect(bytes(quote, q(''))).toBe('""');
    // A payload containing `"` switches to single quotes so nothing needs escaping.
    expect(bytes(quote, k('a"b'))).toBe('\'a"b\'');
    // Both quote characters present: double-quote and escape, since the value
    // serializer writes the payload verbatim.
    expect(bytes(quote, k('a"b\'c'))).toBe('"a\\"b\'c"');
  });

  it('removes quotes and keeps an already-unquoted string identical', () => {
    expect(bytes(unquote, q('c'))).toBe('c');
    expect(bytes(unquote, q('a b'))).toBe('a b');
    expect(bytes(unquote, q(''))).toBe('');
    const unquoted = k('c');
    expect(call(unquote, unquoted)).toBe(unquoted);
  });
});

describe('sass:string — to-upper-case / to-lower-case', () => {
  it('maps ASCII only and preserves quoting', () => {
    expect(bytes(toUpperCase, q('abcDEF'))).toBe('"ABCDEF"');
    expect(bytes(toUpperCase, k('abcDEF'))).toBe('ABCDEF');
    expect(bytes(toLowerCase, q('ABCDEFGHIJKLMNOPQRSTUVQXYZ'))).toBe('"abcdefghijklmnopqrstuvqxyz"');
    expect(bytes(toLowerCase, k('aBcDeF'))).toBe('abcdef');
    expect(bytes(toLowerCase, q('1234567890'))).toBe('"1234567890"');
    // sass-spec `non_ascii`: only ASCII characters have their case changed.
    expect(bytes(toUpperCase, q('äçðøþ'))).toBe('"äçðøþ"');
    expect(bytes(toLowerCase, q('ÄÇÐØÞ'))).toBe('"ÄÇÐØÞ"');
  });
});

describe('sass:string — length', () => {
  it('counts Unicode code points, not UTF-16 code units', () => {
    expect(bytes(length, q(''))).toBe('0');
    expect(bytes(length, q('c'))).toBe('1');
    expect(bytes(length, q('fblthp abatement'))).toBe('16');
    expect(bytes(length, k('loofamonster'))).toBe('12');
    // sass-spec `double_width_character`: one code point, two UTF-16 units.
    expect(bytes(length, q('👭'))).toBe('1');
    expect(bytes(length, q('a😊b'))).toBe('3');
  });
});

describe('sass:string — index', () => {
  it('answers a one-based code-point index, or Sass null', () => {
    expect(bytes(index, q('cde'), q('c'))).toBe('1');
    expect(bytes(index, q('Hello'), q('ll'))).toBe('3');
    expect(bytes(index, q('cde'), q(''))).toBe('1');
    expect(bytes(index, k('Hello'), k('ll'))).toBe('3');
    // Code-point indexing: the emoji counts as one character.
    expect(bytes(index, q('😊abc'), q('abc'))).toBe('2');
    expect(call(index, q('cde'), q('f'))).toMatchObject({ type: 'Null' });
  });
});

describe('sass:string — slice', () => {
  it('is one-based and inclusive on both ends', () => {
    expect(bytes(slice, q('cde'), n(0))).toBe('"cde"');
    expect(bytes(slice, q('cde'), n(1))).toBe('"cde"');
    expect(bytes(slice, q('cde'), n(2))).toBe('"de"');
    expect(bytes(slice, q('cde'), n(4))).toBe('""');
    expect(bytes(slice, q('cde'), n(100))).toBe('""');
    expect(bytes(slice, q('cdef'), n(3), n(2))).toBe('""');
    expect(bytes(slice, q('Hello'), n(2), n(4))).toBe('"ell"');
    expect(bytes(slice, q('Hello'), n(1), n(1))).toBe('"H"');
    expect(bytes(slice, q('Hello'), n(1), n(0))).toBe('""');
    expect(bytes(slice, q('Hello'), n(2), n(100))).toBe('"ello"');
    expect(bytes(slice, k('cdefgh'), n(3), n(5))).toBe('efg');
  });

  it('counts negative indexes back from the end', () => {
    expect(bytes(slice, q('Hello'), n(-3))).toBe('"llo"');
    expect(bytes(slice, q('Hello'), n(-100))).toBe('"Hello"');
    expect(bytes(slice, q('Hello'), n(2), n(-1))).toBe('"ello"');
    expect(bytes(slice, q('Hello'), n(2), n(-2))).toBe('"ell"');
  });

  it('slices by code point so a surrogate pair is never split', () => {
    expect(bytes(slice, q('c👭d'), n(2), n(2))).toBe('"👭"');
    expect(bytes(slice, q('😊abc'), n(1), n(2))).toBe('"😊a"');
  });

  it('rejects a non-integer or united index', () => {
    expect(() => call(slice, q(''), n(0.5))).toThrow('not an int');
    expect(() => call(slice, q(''), n(1), n(1.5))).toThrow('not an int');
    expect(() => call(slice, q(''), n(1, 'px'))).toThrow('no units');
    expect(() => call(slice, q(''), n(1), n(2, 'px'))).toThrow('no units');
  });
});

describe('sass:string — insert', () => {
  it('places the insert so that it starts at the given index', () => {
    expect(bytes(insert, q('Hello'), q('X'), n(3))).toBe('"HeXllo"');
    expect(bytes(insert, q('Hello'), q('X'), n(1))).toBe('"XHello"');
    expect(bytes(insert, q('Hello'), q('X'), n(0))).toBe('"XHello"');
    expect(bytes(insert, q('Hello'), q('X'), n(100))).toBe('"HelloX"');
    // Quoting comes from `$string` alone.
    expect(bytes(insert, k('Hello'), q('X'), n(3))).toBe('HeXllo');
    expect(bytes(insert, q('Hello'), k('X'), n(3))).toBe('"HeXllo"');
  });

  it('corrects a negative index so the insert still lands after that character', () => {
    expect(bytes(insert, q('Hello'), q('X'), n(-1))).toBe('"HelloX"');
    expect(bytes(insert, q('Hello'), q('X'), n(-2))).toBe('"HellXo"');
    expect(bytes(insert, q('Hello'), q('X'), n(-100))).toBe('"XHello"');
  });

  it('inserts at a code-point boundary', () => {
    expect(bytes(insert, q('👭'), q('c'), n(2))).toBe('"👭c"');
  });

  it('rejects a non-integer index', () => {
    expect(() => call(insert, q(''), q(''), n(0.5))).toThrow('not an int');
  });
});

describe('sass:string — unique-id', () => {
  it('returns an unquoted `u` + six base-36 digits, different every call', () => {
    const first = serializeValue(call(uniqueId));
    const second = serializeValue(call(uniqueId));
    expect(first).toMatch(/^u[0-9a-z]{6}$/);
    expect(call(uniqueId)).toMatchObject({ type: 'Keyword' });
    expect(first).not.toBe(second);
  });
});

describe('sass:string — module and global names', () => {
  it('names every module member the way `sass:string` spells it', () => {
    expect(Object.values(stringModule).map(fn => fn.name).sort()).toEqual([
      'index', 'insert', 'length', 'quote', 'slice',
      'to-lower-case', 'to-upper-case', 'unique-id', 'unquote'
    ]);
  });

  it('exposes the deprecated global spellings as their own callables', () => {
    expect(Object.values(stringGlobals).map(fn => fn.name).sort()).toEqual([
      'quote', 'str-index', 'str-insert', 'str-length', 'str-slice',
      'to-lower-case', 'to-upper-case', 'unique-id', 'unquote'
    ]);
    // A renamed global delegates to the one body in the module file.
    expect(bytes(stringGlobals.strLength, q('fblthp abatement'))).toBe('16');
    expect(bytes(stringGlobals.strIndex, q('Hello'), q('ll'))).toBe('3');
    expect(bytes(stringGlobals.strSlice, q('Hello'), n(2), n(4))).toBe('"ell"');
    expect(bytes(stringGlobals.strSlice, q('Hello'), n(2))).toBe('"ello"');
    expect(bytes(stringGlobals.strInsert, q('Hello'), q('X'), n(3))).toBe('"HeXllo"');
    // The `sass:list` and `sass:string` members that collide on the bare name
    // `length` are two different functions; only a per-module table can hold both.
    expect(stringModule.length.name).toBe('length');
    expect(stringGlobals.strLength.name).toBe('str-length');
  });

  it('registers str-length through the Sass dialect index', () => {
    expect(sassGlobals.strLength).toBe(stringGlobals.strLength);
    expect(sassFns.map(fn => fn.name)).toContain('str-length');
    expect(bytes(sassGlobals.strLength, q('fblthp abatement'))).toBe('16');
  });
});
