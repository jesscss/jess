/**
 * Unit tests for key exported functions in extend.ts.
 *
 * These tests pin the CURRENT behaviour so we can safely replace
 * internals with a walk-and-consume algorithm.
 */
import { describe, it, expect } from 'vitest';
import {
  el, sel, sellist, compound, is, co
} from '../../../index.js';
import type { Selector } from '../../../index.js';
import {
  applyExtendsToSelector,
  tryExtendSelector,
  extendSelector,
  createProcessedSelector,
  findChainedExtends,
  type ExtendInstruction
} from '../extend.js';

// ─────────────────────────────────────────────────
// applyExtendsToSelector
// ─────────────────────────────────────────────────
describe('applyExtendsToSelector', () => {
  it('returns original when no instructions', () => {
    const s = el('.a');
    expect(applyExtendsToSelector(s, [])).toBe(s);
  });

  it('applies a single non-partial extend to a SelectorList', () => {
    const target = sellist([el('.base')]);
    const instructions: ExtendInstruction[] = [{
      target: el('.base'),
      extendWith: el('.child'),
      partial: false
    }];
    const result = applyExtendsToSelector(target, instructions);
    const val = result.valueOf();
    expect(val).toContain('.base');
    expect(val).toContain('.child');
  });

  it('applies multiple same-target instructions in one batch', () => {
    const target = sellist([el('.base')]);
    const instructions: ExtendInstruction[] = [
      { target: el('.base'), extendWith: el('.c1'), partial: false },
      { target: el('.base'), extendWith: el('.c2'), partial: false },
      { target: el('.base'), extendWith: el('.c3'), partial: false }
    ];
    const result = applyExtendsToSelector(target, instructions);
    const val = result.valueOf();
    expect(val).toContain('.base');
    expect(val).toContain('.c1');
    expect(val).toContain('.c2');
    expect(val).toContain('.c3');
  });

  it('applies instructions targeting different value', () => {
    const target = sellist([el('.a'), el('.b')]);
    const instructions: ExtendInstruction[] = [
      { target: el('.a'), extendWith: el('.x'), partial: false },
      { target: el('.b'), extendWith: el('.y'), partial: false }
    ];
    const result = applyExtendsToSelector(target, instructions);
    const val = result.valueOf();
    expect(val).toContain('.x');
    expect(val).toContain('.y');
  });

  it('handles chain effects (instruction B targets result of instruction A)', () => {
    // Selector: [.a]
    // Instruction A: .a → .b (produces [.a, .b])
    // Instruction B: .b → .c (produces [.a, .b, .c])
    const target = sellist([el('.a')]);
    const instructions: ExtendInstruction[] = [
      { target: el('.a'), extendWith: el('.b'), partial: false },
      { target: el('.b'), extendWith: el('.c'), partial: false }
    ];
    const result = applyExtendsToSelector(target, instructions);
    const val = result.valueOf();
    expect(val).toContain('.a');
    expect(val).toContain('.b');
    expect(val).toContain('.c');
  });

  it('does not change selector when no instruction matches', () => {
    const target = sellist([el('.a')]);
    const instructions: ExtendInstruction[] = [
      { target: el('.z'), extendWith: el('.x'), partial: false }
    ];
    const result = applyExtendsToSelector(target, instructions);
    expect(result.valueOf()).toBe(target.valueOf());
  });
});

// ─────────────────────────────────────────────────
// tryExtendSelector
// ─────────────────────────────────────────────────
describe('tryExtendSelector', () => {
  it('returns success result for a matching extend', () => {
    const target = el('.a');
    const result = tryExtendSelector(target, el('.a'), el('.b'), false);
    expect(result.error).toBeUndefined();
    expect(result.value.valueOf()).toContain('.b');
  });

  it('returns error result when target is not found', () => {
    const target = el('.a');
    const result = tryExtendSelector(target, el('.z'), el('.b'), false);
    expect(result.error).toBeDefined();
    expect(result.error?.type).toBe('NOT_FOUND');
    expect(result.error).not.toBeInstanceOf(Error);
    expect(result.value).toBe(target); // unchanged
  });

  it('handles partial extend (all keyword)', () => {
    // .a .b target, extend .b with .c (partial=true)
    const target = sel([el('.a'), co(' '), el('.b')]);
    const result = tryExtendSelector(target, el('.b'), el('.c'), true);
    expect(result.error).toBeUndefined();
    const val = result.value.valueOf();
    expect(val).toContain('.c');
  });
});

// ─────────────────────────────────────────────────
// createProcessedSelector
// ─────────────────────────────────────────────────
describe('createProcessedSelector', () => {
  it('deduplicates value at root level', () => {
    const result = createProcessedSelector([el('.a'), el('.a'), el('.b')], true);
    const arr = Array.isArray(result) ? result : [result];
    expect(arr).toHaveLength(2);
    const values = arr.map(s => s.valueOf());
    expect(values).toContain('.a');
    expect(values).toContain('.b');
  });

  it('does NOT deduplicate compound value (non-root)', () => {
    // .a.a.b should keep both .a value
    const result = createProcessedSelector([el('.a'), el('.a'), el('.b')], false);
    const arr = Array.isArray(result) ? result : [result];
    expect(arr).toHaveLength(3);
  });

  it('unwraps single-item :is() at root level', () => {
    // :is(.a) at root should unwrap to just .a
    const isWrapper = is(el('.a'));
    isWrapper.generated = true;
    const result = createProcessedSelector([isWrapper], true);
    const arr = Array.isArray(result) ? result : [result];
    expect(arr).toHaveLength(1);
    expect(arr[0]!.valueOf()).toBe('.a');
  });

  it('passes through simple value unchanged', () => {
    const result = createProcessedSelector([el('.x')], true);
    const arr = Array.isArray(result) ? result : [result];
    expect(arr).toHaveLength(1);
    expect(arr[0]!.valueOf()).toBe('.x');
  });
});

// ─────────────────────────────────────────────────
// findChainedExtends
// ─────────────────────────────────────────────────
describe('findChainedExtends', () => {
  it('returns empty when the result introduces no new selector subtree', () => {
    const extended = el('.base');
    const allExtends: Array<[Selector, Selector, boolean, any, any]> = [
      [el('.a'), el('.x'), false, null, null]
    ];
    const result = findChainedExtends(extended, allExtends, el('.base'), el('.src'), el('.base'));
    expect(result).toHaveLength(0);
  });

  it('finds chained extends from newly added value', () => {
    // Original: .base
    // After extending .base with .middle → SelectorList([.base, .middle])
    // Another extend targets .middle → should chain
    const extended = sellist([el('.base'), el('.middle')]);
    const allExtends: Array<[Selector, Selector, boolean, any, any]> = [
      [el('.base'), el('.src1'), false, null, null],
      [el('.middle'), el('.src2'), false, null, null]
    ];
    const result = findChainedExtends(extended, allExtends, el('.base'), el('.src1'), el('.base'));
    expect(result).toHaveLength(1);
    expect(result[0]![0].valueOf()).toBe('.middle');
    expect(result[0]![1].valueOf()).toBe('.src2');
  });

  it('does NOT chain on value that were in the original', () => {
    // Original: SelectorList([.base, .existing])
    // After extending .base with .child → SelectorList([.base, .existing, .child])
    // Another extend targets .existing → should NOT chain (it was original)
    const extended = sellist([el('.base'), el('.existing'), el('.child')]);
    const original = sellist([el('.base'), el('.existing')]);
    const allExtends: Array<[Selector, Selector, boolean, any, any]> = [
      [el('.base'), el('.src1'), false, null, null],
      [el('.existing'), el('.src2'), false, null, null]
    ];
    const result = findChainedExtends(extended, allExtends, el('.base'), el('.src1'), original);
    // .existing was in original → not chained. Only .child could chain but nothing targets it.
    expect(result).toHaveLength(0);
  });

  it('finds chained extends from newly introduced nested selector subtrees', () => {
    const extended = compound([
      is(sellist([el('.g'), compound([el('.i'), el('.j')])])),
      el('.h')
    ]);
    const allExtends: Array<[Selector, Selector, boolean, any, any]> = [
      [el('.g'), compound([el('.i'), el('.j')]), true, null, null],
      [el('.i'), el('.k'), true, null, null]
    ];

    const result = findChainedExtends(extended, allExtends, el('.g'), compound([el('.i'), el('.j')]), compound([el('.g'), el('.h')]));
    expect(result).toHaveLength(1);
    expect(result[0]![0].valueOf()).toBe('.i');
    expect(result[0]![1].valueOf()).toBe('.k');
  });
});

// ─────────────────────────────────────────────────
// extendSelector — integration-level pins
// ─────────────────────────────────────────────────
describe('extendSelector integration pins', () => {
  it('non-partial: .a extending .a with .b → SelectorList(.a, .b)', () => {
    const result = extendSelector(el('.a'), el('.a'), el('.b'), false);
    const val = result.valueOf();
    expect(val).toContain('.a');
    expect(val).toContain('.b');
  });

  it('non-partial: SelectorList(.a, .b) extending .a with .c → SelectorList(.a, .b, .c)', () => {
    const target = sellist([el('.a'), el('.b')]);
    const result = extendSelector(target, el('.a'), el('.c'), false);
    const val = result.valueOf();
    expect(val).toContain('.a');
    expect(val).toContain('.b');
    expect(val).toContain('.c');
  });

  it('partial: .a .b extending .b with .c → creates :is() wrapper', () => {
    const target = sel([el('.a'), co(' '), el('.b')]);
    const result = extendSelector(target, el('.b'), el('.c'), true);
    const val = result.valueOf();
    // Partial mode wraps the matched component in :is()
    expect(val).toContain(':is');
    expect(val).toContain('.c');
  });

  it('non-partial: compound .a.b extending .a with .c → unchanged (non-partial requires whole match)', () => {
    const target = compound([el('.a'), el('.b')]);
    const result = extendSelector(target, el('.a'), el('.c'), false);
    // Non-partial extend requires whole-selector match; .a.b ≠ .a
    expect(result.valueOf()).toBe('.a.b');
  });
});
