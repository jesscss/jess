/**
 * `@arguments` is the ordered, default-filled, param-order binding of a mixin
 * call — NOT the raw positional call args. Oracle: less@4.6.3.
 *
 *   .mixin(@a, @b: 20px, @c: 30px) { args: @arguments; }
 *
 *   .mixin(@b: 2px, @a: 1px)  =>  1px 2px 30px   (named-only)
 *   .mixin(1px, 2px)          =>  1px 2px 30px   (omits a defaulted slot)
 *   .mixin(1px, @c: 9px)      =>  1px 20px 9px   (mixed positional + named)
 *   .mixin(1px, 2px, 3px)     =>  1px 2px 3px    (all-positional; unchanged)
 *
 * Each expectation below was captured from `npx less@4.6.3`.
 */
import { describe, it, expect } from 'vitest';
import {
  bindArgs,
  mixinDef,
  mixinCall,
  word,
  type Word,
  type MixinCall,
  type MixinDef,
  type Param,
  type ValueNode,
} from '../index.js';

// Caller-frame resolver for byte-literal args: our test args/defaults are plain
// `Word`s, so their bytes are their text (mirrors the pipeline's eval-to-bytes).
const resolve = (v: ValueNode): string => (v.type === 'Word' ? v.text : '');

const argumentsOf = (def: MixinDef, call: MixinCall): string => {
  const bound = bindArgs(def, call, resolve);
  expect(bound).not.toBeNull();
  const a = bound!.get('arguments');
  expect(a?.type).toBe('Word');
  return (a as Word).text;
};

describe('mixin @arguments (vs less@4.6.3)', () => {
  const params: Param[] = [
    { name: 'a' },
    { name: 'b', default: word('20px') },
    { name: 'c', default: word('30px') },
  ];
  const def = mixinDef('.mixin', params, []);

  it('(a) named-only call fills every slot in PARAM order, not call order', () => {
    const call = mixinCall('.mixin', [
      { value: word('2px'), name: 'b' },
      { value: word('1px'), name: 'a' },
    ]);
    expect(argumentsOf(def, call)).toBe('1px 2px 30px');
  });

  it('(b) call omitting a defaulted param includes the default-filled slot', () => {
    const call = mixinCall('.mixin', [word('1px'), word('2px')]);
    expect(argumentsOf(def, call)).toBe('1px 2px 30px');
  });

  it('(c) mixed positional + named emits param order with defaults filled', () => {
    const call = mixinCall('.mixin', [word('1px'), { value: word('9px'), name: 'c' }]);
    expect(argumentsOf(def, call)).toBe('1px 20px 9px');
  });

  it('(d) all-positional call is unchanged (byte-identical regression guard)', () => {
    const call = mixinCall('.mixin', [word('1px'), word('2px'), word('3px')]);
    expect(argumentsOf(def, call)).toBe('1px 2px 3px');
  });

  it('pattern-literal slots bind no variable and are excluded', () => {
    // .mixin(red, @a) called as .mixin(red, 5px) => "5px" (less@4.6.3)
    const patDef = mixinDef('.mixin', [{ pattern: word('red') }, { name: 'a' }], []);
    const call = mixinCall('.mixin', [word('red'), word('5px')]);
    expect(argumentsOf(patDef, call)).toBe('5px');
  });

  it('a variadic rest expands each arg; an empty rest contributes nothing', () => {
    const restDef = mixinDef('.mixin', [{ name: 'a' }, { name: 'rest', rest: true }], []);
    // .mixin(1px, 2px, 3px, 4px) => "1px 2px 3px 4px"
    expect(
      argumentsOf(restDef, mixinCall('.mixin', [word('1px'), word('2px'), word('3px'), word('4px')])),
    ).toBe('1px 2px 3px 4px');
    // .mixin(1px) => "1px" (no trailing space from the empty rest slot)
    expect(argumentsOf(restDef, mixinCall('.mixin', [word('1px')]))).toBe('1px');
  });

  it('an all-pattern mixin yields an empty @arguments', () => {
    const patOnly = mixinDef('.mixin', [{ pattern: word('red') }], []);
    expect(argumentsOf(patOnly, mixinCall('.mixin', [word('red')]))).toBe('');
  });
});
