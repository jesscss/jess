import { describe, expect, it } from 'vitest';
import { makeLessRegistry } from '@jesscss/fns';
import { buildEvaluator } from '../evaluator.js';
import { serialize, type SerializeReturn } from '../serialize.js';
import { defineFunction } from '../value-dispatch.js';
import { makeKeyword } from '../value-factory.js';
import { groupItems } from '../value-list.js';
import { isValueGroupArray, type ValueGroup } from '../value-eval.js';
import { parse as parseLess } from '../../../../syntax/less/less-parser/src/index.js';

/*
 * A call written out as-is keeps its structure: a callable that receives one
 * reads its name and its evaluated arguments, which nest
 * (docs/design/CSS-NATIVE-BUILTINS.md §3.2, slice 1). `shape()` writes what it
 * received as `name[arg arg …]`, `-` for an argument that is no call.
 */
const shape = (value: ValueGroup): string =>
  isValueGroupArray(value) || value.type !== 'Keyword' || value.call === null
    ? '-'
    : `${value.call.name}[${groupItems(value.call.args).map(shape).join(' ')}]`;

const registry = makeLessRegistry();
registry.register(defineFunction('shape', {
  params: [{ name: 'value', type: 'any' }],
  body: value => makeKeyword(shape(value))
}));
const evaluator = buildEvaluator(registry);
const css = (out: SerializeReturn): string | undefined => (out instanceof Promise ? undefined : out.css);
const value = (source: string): string | undefined =>
  css(serialize(parseLess(`.a { x: ${source}; }`), { evaluator }))?.match(/x: (.*);/)?.[1];

describe('a call written out as-is', () => {
  it('reaches a callable as its name and arguments, nested', () => {
    expect(value('shape(color-mix(in srgb, var(--a), red))')).toBe('color-mix[- var[-] -]');
    expect(value('shape(foo(bar(1), 2))')).toBe('foo[bar[-] -]');
  });

  it('includes a built-in that could not compute', () => {
    expect(value('shape(darken(var(--a), 10%))')).toBe('darken[var[-] -]');
  });

  it('is absent from any other value', () => {
    expect(value('shape(solid)')).toBe('-');
  });

  it('prints as it did', () => {
    expect(value('color-mix(in srgb, var(--a), red)')).toBe('color-mix(in srgb, var(--a), red)');
    expect(value('darken(var(--a), 10%)')).toBe('darken(var(--a), 10%)');
  });
});
