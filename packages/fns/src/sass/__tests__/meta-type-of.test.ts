/**
 * `sass:meta` — `type-of`, previously implemented nowhere in `packages/fns`.
 *
 * Cases from sass-spec `spec/core_functions/meta/type_of.hrx`.
 */
import { isValueGroupArray, makeBlock, makeBool, makeCollection, makeColorRgb, makeDimension, makeKeyword, makeList, makeQuoted, HEX } from '@jesscss/core/value';
import { describe, it, expect } from 'vitest';
import { typeOf } from '../meta/type-of.js';

/** Narrow `type-of`'s synchronous Keyword result without a type assertion. */
const text = (value: ReturnType<typeof typeOf>): string => {
  if (value instanceof Promise || isValueGroupArray(value) || value.type !== 'Keyword') {
    throw new TypeError('expected a Keyword result');
  }
  return value.text;
};

describe('sass:meta — type-of', () => {
  it('§ number/unitless and § number/unit', () => {
    expect(text(typeOf(makeDimension(1)))).toBe('number');
    expect(text(typeOf(makeDimension(1.5, 'px')))).toBe('number');
  });

  it('§ string/quoted and § string/unquoted', () => {
    expect(text(typeOf(makeQuoted('c', '"', false)))).toBe('string');
    expect(text(typeOf(makeKeyword('c')))).toBe('string');
  });

  it('§ color', () => {
    expect(text(typeOf(makeColorRgb([255, 0, 0], 1, HEX)))).toBe('color');
  });

  it('§ boolean/true and § boolean/false', () => {
    expect(text(typeOf(makeBool(true)))).toBe('bool');
    expect(text(typeOf(makeBool(false)))).toBe('bool');
  });

  it('§ null', () => {
    expect(text(typeOf({ type: 'Nil', bytes: '' }))).toBe('null');
  });

  it('§ list/empty and § list/non_empty', () => {
    expect(text(typeOf([]))).toBe('list');
    expect(text(typeOf([makeDimension(1), makeDimension(2), makeDimension(3)]))).toBe('list');
    expect(text(typeOf(makeList([makeDimension(1), makeDimension(2)], ',')))).toBe('list');
    expect(text(typeOf(makeBlock([makeDimension(1)], 'square')))).toBe('list');
  });

  it('§ map — a Collection is a map, but the empty list is still a list', () => {
    expect(text(typeOf(makeCollection([{ key: makeKeyword('a'), value: makeDimension(1) }])))).toBe('map');
    expect(text(typeOf([]))).toBe('list');
  });

  it('takes exactly one argument (§ error/too_many_args)', () => {
    expect(typeOf.params).toHaveLength(1);
    expect(typeOf.name).toBe('type-of');
  });
});
