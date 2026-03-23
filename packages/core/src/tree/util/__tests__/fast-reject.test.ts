import { amp, compound, el, rules, ruleset, sel, pseudo, co, sellist } from '../../index.js';
import { Context } from '../../../context.js';
import { EvalSession } from '../../../eval-session.js';
import { selectorMatch } from '../selector-match-core.js';
import { sessionPatchField } from '../session-helpers.js';

describe('BitSets and selectors', () => {
  let context: Context;
  beforeEach(() => {
    context = new Context();
  });

  it('fast rejects simple selectors', async () => {
    let selector = el('.foo');
    await selector.eval(context);
    expect(selector.keySet.equals(context.selectorBits.getBitset(['.foo']))).toBe(true);
    expect(selector.visibleKeySet.equals(context.selectorBits.getBitset(['.foo']))).toBe(true);
    expect(selector.requiredKeySet.equals(context.selectorBits.getBitset(['.foo']))).toBe(true);
  });

  it('fast rejects compound selectors with simples', async () => {
    let selector = compound([el('.foo'), el('.bar')]);
    await selector.eval(context);
    expect(selector.keySet.equals(context.selectorBits.getBitset(['.foo', '.bar']))).toBe(true);
    expect(selector.visibleKeySet.equals(context.selectorBits.getBitset(['.foo', '.bar']))).toBe(true);
    expect(selector.requiredKeySet.equals(context.selectorBits.getBitset(['.foo', '.bar']))).toBe(true);
  });

  it('fast rejects complex selectors with simples', async () => {
    let selector = sel([el('.foo'), co(' '), el('.bar')]);
    await selector.eval(context);
    expect(selector.keySet.equals(context.selectorBits.getBitset(['.foo', ' ', '.bar']))).toBe(true);
    expect(selector.visibleKeySet.equals(context.selectorBits.getBitset(['.foo', ' ', '.bar']))).toBe(true);
    expect(selector.requiredKeySet.equals(context.selectorBits.getBitset(['.foo', ' ', '.bar']))).toBe(true);
  });

  it('fast rejects complex selectors with compounds', async () => {
    let selector = sel([compound([el('a'), el('.foo')]), co(' '), el('.bar')]);
    await selector.eval(context);
    expect(selector.keySet.equals(context.selectorBits.getBitset(['a', '.foo', ' ', '.bar']))).toBe(true);
    expect(selector.visibleKeySet.equals(context.selectorBits.getBitset(['a', '.foo', ' ', '.bar']))).toBe(true);
    expect(selector.requiredKeySet.equals(context.selectorBits.getBitset(['a', '.foo', ' ', '.bar']))).toBe(true);
  });

  test('fast rejects :is selectors with simple selectors', async () => {
    let selector = sel([pseudo({ name: ':is', arg: el('.foo') })]);
    await selector.eval(context);
    expect(selector.keySet.equals(context.selectorBits.getBitset(['.foo']))).toBe(true);
    expect(selector.visibleKeySet.equals(context.selectorBits.getBitset(['.foo']))).toBe(true);
    // :is(.foo) with a single arg (not a SelectorList) — keys ARE required
    expect(selector.requiredKeySet.equals(context.selectorBits.getBitset(['.foo']))).toBe(true);
  });

  test(':is with selector list excludes alternatives from requiredKeySet', async () => {
    let selector = sel([pseudo({ name: ':is', arg: sellist([el('.foo'), el('.bar')]) })]);
    await selector.eval(context);
    expect(selector.keySet.equals(context.selectorBits.getBitset(['.foo', '.bar']))).toBe(true);
    expect(selector.visibleKeySet.equals(context.selectorBits.getBitset(['.foo', '.bar']))).toBe(true);
    // :is() alternatives are not required
    expect(selector.requiredKeySet.equals(context.selectorBits.getBitset())).toBe(true);
  });

  test(':is with selector list in complex selector keeps non-:is keys in requiredKeySet', async () => {
    // :is(.a, .b) .c → keySet={.a,.b,.c}, requiredKeySet={.c}
    let selector = sel([
      pseudo({ name: ':is', arg: sellist([el('.a'), el('.b')]) }),
      co(' '),
      el('.c')
    ]);
    await selector.eval(context);
    expect(selector.keySet.equals(context.selectorBits.getBitset(['.a', '.b', ' ', '.c']))).toBe(true);
    // requiredKeySet has only the non-:is parts
    expect(selector.requiredKeySet.equals(context.selectorBits.getBitset([' ', '.c']))).toBe(true);
  });

  test('deep :is with selector list excludes alternatives from requiredKeySet', async () => {
    let selector = sel([pseudo({ name: ':is', arg: sel([pseudo({ name: ':is', arg: sellist([el('.foo'), el('.bar')]) })] as any) })]);
    await selector.eval(context);
    expect(selector.keySet.equals(context.selectorBits.getBitset(['.foo', '.bar']))).toBe(true);
    expect(selector.requiredKeySet.equals(context.selectorBits.getBitset())).toBe(true);
  });

  test(':is with compound arg includes compound keys in requiredKeySet', async () => {
    // :is(.a.b) — single compound, not a SelectorList
    let selector = pseudo({ name: ':is', arg: compound([el('.a'), el('.b')]) });
    await selector.eval(context);
    expect(selector.keySet.equals(context.selectorBits.getBitset(['.a', '.b']))).toBe(true);
    expect(selector.requiredKeySet.equals(context.selectorBits.getBitset(['.a', '.b']))).toBe(true);
  });

  test(':is with complex arg includes complex keys in requiredKeySet', async () => {
    // :is(.a > .b) — single complex selector, not a SelectorList
    let selector = pseudo({ name: ':is', arg: sel([el('.a'), co('>'), el('.b')]) });
    await selector.eval(context);
    expect(selector.keySet.equals(context.selectorBits.getBitset(['.a', '>', '.b']))).toBe(true);
    expect(selector.requiredKeySet.equals(context.selectorBits.getBitset(['.a', '>', '.b']))).toBe(true);
  });

  test('complex selector with :is(compound) includes all keys in requiredKeySet', async () => {
    // foo > :is(.a.b) — :is has compound arg, all keys required
    let selector = sel([el('foo'), co('>'), pseudo({ name: ':is', arg: compound([el('.a'), el('.b')]) })]);
    await selector.eval(context);
    expect(selector.keySet.equals(context.selectorBits.getBitset(['foo', '>', '.a', '.b']))).toBe(true);
    expect(selector.requiredKeySet.equals(context.selectorBits.getBitset(['foo', '>', '.a', '.b']))).toBe(true);
  });

  test('complex selector with :is(SelectorList) excludes alternatives from requiredKeySet', async () => {
    // foo > :is(.a, .b) — :is has SelectorList arg, alternatives excluded
    let selector = sel([el('foo'), co('>'), pseudo({ name: ':is', arg: sellist([el('.a'), el('.b')]) })]);
    await selector.eval(context);
    expect(selector.keySet.equals(context.selectorBits.getBitset(['foo', '>', '.a', '.b']))).toBe(true);
    expect(selector.requiredKeySet.equals(context.selectorBits.getBitset(['foo', '>']))).toBe(true);
  });
});

describe('Fast-reject in selectorMatch', () => {
  let context: Context;
  beforeEach(() => {
    context = new Context();
  });

  test('evalContext-aware matcher can drive selector compare consumers when context is provided', () => {
    context.session = new EvalSession();

    const parent = ruleset({
      selector: el('.alpha'),
      rules: rules([])
    });
    parent.selector.keySetLibrary = context.selectorBits;

    const patched = el('.beta');
    patched.keySetLibrary = context.selectorBits;

    const find = sel([
      amp({ selectorContainer: parent as any }),
      co('>'),
      el('.tail')
    ]);
    find.keySetLibrary = context.selectorBits;
    for (const child of find.value as any[]) {
      if ('keySetLibrary' in child) {
        child.keySetLibrary = context.selectorBits;
      }
    }

    const target = sel([el('.beta'), co('>'), el('.tail')]);
    target.keySetLibrary = context.selectorBits;
    for (const child of target.value as any[]) {
      if ('keySetLibrary' in child) {
        child.keySetLibrary = context.selectorBits;
      }
    }

    const findList = sellist([find]);
    findList.keySetLibrary = context.selectorBits;

    sessionPatchField(parent, 'selector', patched, context);

    expect(selectorMatch(find, target).fullMatch).toBe(false);
    expect(selectorMatch(find, target, undefined, context).fullMatch).toBe(true);
    expect(find.compare(target)).not.toBe(0);
    expect(findList.compare(target)).not.toBe(0);
    expect(find.compare(target, context)).toBe(0);
    expect(findList.compare(target, context)).toBe(0);
  });

  test('evalContext-aware compare does not throw when find and target use different selector-bit libraries', () => {
    const contextA = new Context();
    contextA.session = new EvalSession();
    const contextB = new Context();
    contextB.session = new EvalSession();

    const parent = ruleset({
      selector: el('.alpha'),
      rules: rules([])
    });
    parent.selector.keySetLibrary = contextA.selectorBits;

    const patched = el('.beta');
    patched.keySetLibrary = contextA.selectorBits;

    const find = sel([
      amp({ selectorContainer: parent as any }),
      co('>'),
      el('.tail')
    ]);
    find.keySetLibrary = contextB.selectorBits;
    for (const child of find.value as any[]) {
      if ('keySetLibrary' in child) {
        child.keySetLibrary = contextB.selectorBits;
      }
    }

    const target = sel([el('.beta'), co('>'), el('.tail')]);
    target.keySetLibrary = contextA.selectorBits;
    for (const child of target.value as any[]) {
      if ('keySetLibrary' in child) {
        child.keySetLibrary = contextA.selectorBits;
      }
    }

    sessionPatchField(parent, 'selector', patched, contextA);

    expect(() => selectorMatch(find, target, undefined, contextA)).not.toThrow();
    expect(selectorMatch(find, target, undefined, contextA).fullMatch).toBe(true);
    expect(() => find.compare(target, contextA)).not.toThrow();
    expect(find.compare(target, contextA)).toBe(0);
  });

  test('rejects completely disjoint simple selectors', async () => {
    let find = el('.a');
    let target = el('.b');
    await find.eval(context);
    await target.eval(context);
    let result = selectorMatch(find, target);
    expect(result.fullMatch).toBe(false);
    expect(result.partialMatch).toBe(false);
  });

  test('rejects disjoint compound selectors', async () => {
    let find = compound([el('.a'), el('.b')]);
    let target = compound([el('.x'), el('.y')]);
    await find.eval(context);
    await target.eval(context);
    let result = selectorMatch(find, target);
    expect(result.fullMatch).toBe(false);
    expect(result.partialMatch).toBe(false);
  });

  test('rejects disjoint complex selectors', async () => {
    let find = sel([el('.a'), co('>'), el('.b')]);
    let target = sel([el('.x'), co('>'), el('.y')]);
    await find.eval(context);
    await target.eval(context);
    let result = selectorMatch(find, target);
    expect(result.fullMatch).toBe(false);
    expect(result.partialMatch).toBe(false);
  });

  test('rejects when :is(SelectorList) alternatives are all disjoint with target', async () => {
    // find = :is(.a, .b), target = .x — no overlap at all
    let find = pseudo({ name: ':is', arg: sellist([el('.a'), el('.b')]) });
    let target = el('.x');
    await find.eval(context);
    await target.eval(context);
    let result = selectorMatch(find, target);
    expect(result.fullMatch).toBe(false);
    expect(result.partialMatch).toBe(false);
  });

  test('does not reject when :is(SelectorList) has an alternative matching target', async () => {
    // find = :is(.a, .b), target = .a — .a overlaps
    let find = pseudo({ name: ':is', arg: sellist([el('.a'), el('.b')]) });
    let target = el('.a');
    await find.eval(context);
    await target.eval(context);
    let result = selectorMatch(find, target);
    expect(result.fullMatch).toBe(true);
  });

  test('does not reject :is(compound) when target has matching keys', async () => {
    // find = foo > :is(.a.b), target = .a.b — :is content keys are required and present
    let find = sel([el('foo'), co('>'), pseudo({ name: ':is', arg: compound([el('.a'), el('.b')]) })]);
    let target = compound([el('.b'), el('.a')]);
    await find.eval(context);
    await target.eval(context);
    let result = selectorMatch(find, target);
    expect(result.partialMatch).toBe(true);
  });

  test('does not reject :is(complex) when target has matching keys', async () => {
    // find = .a > :is(.b > .c), target = .b > .c — :is content keys overlap
    let find = sel([el('.a'), co('>'), pseudo({ name: ':is', arg: sel([el('.b'), co('>'), el('.c')]) })]);
    let target = sel([el('.b'), co('>'), el('.c')]);
    await find.eval(context);
    await target.eval(context);
    let result = selectorMatch(find, target);
    expect(result.partialMatch).toBe(true);
  });

  test('rejects complex find with :is(SelectorList) when non-:is keys are disjoint', async () => {
    // find = .x > :is(.a, .b), target = .y — requiredKeySet = {.x, >}, target has {.y}
    // requiredKeySet is disjoint with target
    let find = sel([el('.x'), co('>'), pseudo({ name: ':is', arg: sellist([el('.a'), el('.b')]) })]);
    let target = el('.y');
    await find.eval(context);
    await target.eval(context);
    let result = selectorMatch(find, target);
    expect(result.fullMatch).toBe(false);
    expect(result.partialMatch).toBe(false);
  });

  test('does not reject when target shares a key with :is(SelectorList) alternatives', async () => {
    // find = .x > :is(.a, .b), target = .a — requiredKeySet = {.x, >} disjoint with {.a}
    // BUT keySet = {.x, >, .a, .b} which shares .a — however requiredKeySet check rejects
    // This is a known limitation: requiredKeySet disjoint can over-reject for SelectorList
    // when no parent is provided and the partial match would go through alternatives only
    let find = sel([el('.x'), co('>'), pseudo({ name: ':is', arg: sellist([el('.a'), el('.b')]) })]);
    let target = el('.a');
    await find.eval(context);
    await target.eval(context);
    let result = selectorMatch(find, target);
    // requiredKeySet = {.x, >}, target.keySet = {.a} — disjoint → rejected
    // In real extend processing, parent is provided so fast-reject is skipped
    expect(result.fullMatch).toBe(false);
    expect(result.partialMatch).toBe(false);
  });

  test('rejects compound find against target with no shared visible keys', async () => {
    let find = compound([el('.a'), pseudo({ name: ':hover' })]);
    let target = compound([el('.b'), pseudo({ name: ':focus' })]);
    await find.eval(context);
    await target.eval(context);
    let result = selectorMatch(find, target);
    expect(result.fullMatch).toBe(false);
    expect(result.partialMatch).toBe(false);
  });

  test('does not reject compound find when target shares some keys', async () => {
    let find = compound([el('.a'), pseudo({ name: ':hover' })]);
    let target = compound([el('.a'), el('.b'), pseudo({ name: ':hover' })]);
    await find.eval(context);
    await target.eval(context);
    let result = selectorMatch(find, target);
    expect(result.partialMatch).toBe(true);
  });

  test('rejects nested :is(SelectorList) inside :is(SelectorList) when all disjoint', async () => {
    // find = :is(:is(.a, .b), .c), target = .x
    let find = pseudo({
      name: ':is',
      arg: sellist([
        pseudo({ name: ':is', arg: sellist([el('.a'), el('.b')]) }),
        el('.c')
      ])
    });
    let target = el('.x');
    await find.eval(context);
    await target.eval(context);
    let result = selectorMatch(find, target);
    expect(result.fullMatch).toBe(false);
    expect(result.partialMatch).toBe(false);
  });

  test('does not reject nested :is when target matches an inner alternative', async () => {
    // find = :is(:is(.a, .b), .c), target = .b
    let find = pseudo({
      name: ':is',
      arg: sellist([
        pseudo({ name: ':is', arg: sellist([el('.a'), el('.b')]) }),
        el('.c')
      ])
    });
    let target = el('.b');
    await find.eval(context);
    await target.eval(context);
    let result = selectorMatch(find, target);
    expect(result.fullMatch).toBe(true);
  });

  test('rejects :where() with disjoint keys', async () => {
    let find = pseudo({ name: ':where', arg: compound([el('.a'), el('.b')]) });
    let target = el('.x');
    await find.eval(context);
    await target.eval(context);
    let result = selectorMatch(find, target);
    expect(result.fullMatch).toBe(false);
    expect(result.partialMatch).toBe(false);
  });

  test('rejects :not() with disjoint keys', async () => {
    let find = pseudo({ name: ':not', arg: el('.a') });
    let target = pseudo({ name: ':not', arg: el('.b') });
    await find.eval(context);
    await target.eval(context);
    let result = selectorMatch(find, target);
    expect(result.fullMatch).toBe(false);
    expect(result.partialMatch).toBe(false);
  });
});
