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
import { bindArgs } from '../mixin-dispatch.js';
import {
  mixinDef, mixinCall, any, isLiteralNode, keyword,
  type MixinCall, type MixinDefinition, type Param, type ValueSlot
} from '../nodes.js';

/*
 * Caller-frame resolver for byte-literal args: our test args/defaults are plain
 * `Any` leaves, so their bytes are their `src` (mirrors the pipeline's eval-to-bytes).
 */
const resolve = (v: ValueSlot): string =>
  'type' in v ? (isLiteralNode(v) ? v.src : '') : v.map(resolve).join(' ');

const argumentsOf = (def: MixinDefinition, call: MixinCall): ValueSlot => {
  const bound = bindArgs(def, call, resolve);
  expect(bound).not.toBeNull();
  const a = bound!.get('arguments');
  if (a === undefined) {
    throw new TypeError('Expected @arguments to retain a structural value group.');
  }
  return a;
};

const slotText = (value: ValueSlot): string => {
  if (Array.isArray(value)) {
    return value.map(slotText).join(' ');
  }
  if (value.type === 'List') {
    return value.value.map(slotText).join(value.sep === ',' ? ', ' : ' ');
  }
  return isLiteralNode(value) ? value.src : '';
};

const argumentsText = (def: MixinDefinition, call: MixinCall): string => slotText(argumentsOf(def, call));

describe('mixin @arguments (vs less@4.6.3)', () => {
  const params: Param[] = [
    { name: 'a' },
    { name: 'b', default: any('20px') },
    { name: 'c', default: any('30px') }
  ];
  const def = mixinDef('.mixin', params, []);

  it('(a) named-only call fills every slot in PARAM order, not call order', () => {
    const call = mixinCall('.mixin', [
      { value: any('2px'), name: 'b' },
      { value: any('1px'), name: 'a' }
    ]);
    expect(argumentsText(def, call)).toBe('1px 2px 30px');
  });

  it('(b) call omitting a defaulted param includes the default-filled slot', () => {
    const call = mixinCall('.mixin', [any('1px'), any('2px')]);
    expect(argumentsText(def, call)).toBe('1px 2px 30px');
  });

  it('(c) mixed positional + named emits param order with defaults filled', () => {
    const call = mixinCall('.mixin', [any('1px'), { value: any('9px'), name: 'c' }]);
    expect(argumentsText(def, call)).toBe('1px 20px 9px');
  });

  it('keeps the final duplicate named value while positional/rest args fill their remaining slots', () => {
    const restDef = mixinDef('.mixin', [
      { name: 'a' },
      { name: 'b', default: any('20px') },
      { name: 'rest', rest: true }
    ], []);
    const call = mixinCall('.mixin', [
      any('1px'),
      { value: any('2px'), name: 'b' },
      { value: any('3px'), name: 'b' },
      any('4px')
    ]);

    expect(argumentsText(restDef, call)).toBe('1px 3px 4px');
  });

  it('(d) all-positional call is unchanged (byte-identical regression guard)', () => {
    const call = mixinCall('.mixin', [any('1px'), any('2px'), any('3px')]);
    expect(argumentsText(def, call)).toBe('1px 2px 3px');
  });

  it('resolves a recursive value-slot argument without treating its array as a node', () => {
    const call: MixinCall = {
      type: 'MixinCall',
      name: '.mixin',
      args: [{ value: [[any('1px'), any('2px')]] }],
      path: [],
      important: false,
      content: null
    };
    expect(argumentsText(def, call)).toBe('1px 2px 20px 30px');
  });

  it('resolves a recursive default value slot through the bound-default resolver', () => {
    const nestedDefault = mixinDef('.nested', [
      { name: 'value', default: [[any('1px'), any('2px')]] }
    ], []);
    expect(argumentsText(nestedDefault, mixinCall('.nested'))).toBe('1px 2px');
  });

  it('pattern-literal slots bind no variable and are excluded', () => {
    // .mixin(red, @a) called as .mixin(red, 5px) => "5px" (less@4.6.3)
    const patDef = mixinDef('.mixin', [{ pattern: any('red') }, { name: 'a' }], []);
    const call = mixinCall('.mixin', [any('red'), any('5px')]);
    expect(argumentsText(patDef, call)).toBe('5px');
  });

  it('a variadic rest expands each arg; an empty rest contributes nothing', () => {
    const restDef = mixinDef('.mixin', [{ name: 'a' }, { name: 'rest', rest: true }], []);

    // .mixin(1px, 2px, 3px, 4px) => "1px 2px 3px 4px"
    expect(argumentsText(restDef, mixinCall('.mixin', [any('1px'), any('2px'), any('3px'), any('4px')]))).toBe('1px 2px 3px 4px');

    // .mixin(1px) => "1px" (no trailing space from the empty rest slot)
    expect(argumentsText(restDef, mixinCall('.mixin', [any('1px')]))).toBe('1px');
  });

  it('an all-pattern mixin yields an empty @arguments', () => {
    const patOnly = mixinDef('.mixin', [{ pattern: any('red') }], []);
    expect(argumentsText(patOnly, mixinCall('.mixin', [any('red')]))).toBe('');
  });

  it('keeps a sole authored space-list as one structural rest argument', () => {
    const restDef = mixinDef('.mixin', [{ name: 'values', rest: true }], []);
    const authored = [keyword('a'), keyword('b'), keyword('c')] as const;
    const bound = bindArgs(restDef, mixinCall('.mixin', [{ value: authored }]), resolve);

    expect(bound?.get('values')).toEqual([authored]);
    expect(argumentsOf(restDef, mixinCall('.mixin', [{ value: authored }]))).toEqual([authored]);
  });
});
