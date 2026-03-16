import { compound, el, sel, pseudo, co, sellist } from '../../index.js';
import { Context } from '../../../context.js';

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
    expect(selector.canFastReject).toBe(true);
  });

  it('fast rejects compound selectors with simples', async () => {
    let selector = compound([el('.foo'), el('.bar')]);
    await selector.eval(context);
    expect(selector.keySet.equals(context.selectorBits.getBitset(['.foo', '.bar']))).toBe(true);
    expect(selector.visibleKeySet.equals(context.selectorBits.getBitset(['.foo', '.bar']))).toBe(true);
    expect(selector.canFastReject).toBe(true);
  });

  it('fast rejects complex selectors with simples', async () => {
    let selector = sel([el('.foo'), co(' '), el('.bar')]);
    await selector.eval(context);
    expect(selector.keySet.equals(context.selectorBits.getBitset(['.foo', ' ', '.bar']))).toBe(true);
    expect(selector.visibleKeySet.equals(context.selectorBits.getBitset(['.foo', ' ', '.bar']))).toBe(true);
    expect(selector.canFastReject).toBe(true);
  });

  it('fast rejects complex selectors with compounds', async () => {
    let selector = sel([compound([el('a'), el('.foo')]), co(' '), el('.bar')]);
    await selector.eval(context);
    expect(selector.keySet.equals(context.selectorBits.getBitset(['a', '.foo', ' ', '.bar']))).toBe(true);
    expect(selector.visibleKeySet.equals(context.selectorBits.getBitset(['a', '.foo', ' ', '.bar']))).toBe(true);
    expect(selector.canFastReject).toBe(true);
  });

  test('fast rejects :is selectors with simple selectors', async () => {
    let selector = sel([pseudo({ name: ':is', arg: el('.foo') })]);
    await selector.eval(context);
    expect(selector.keySet.equals(context.selectorBits.getBitset(['.foo']))).toBe(true);
    expect(selector.visibleKeySet.equals(context.selectorBits.getBitset(['.foo']))).toBe(true);
    expect(selector.canFastReject).toBe(true);
  });

  test('cannot fast reject :is selectors with selector lists', async () => {
    let selector = sel([pseudo({ name: ':is', arg: sellist([el('.foo'), el('.bar')]) })]);
    await selector.eval(context);
    expect(selector.keySet.equals(context.selectorBits.getBitset(['.foo', '.bar']))).toBe(true);
    expect(selector.visibleKeySet.equals(context.selectorBits.getBitset(['.foo', '.bar']))).toBe(true);
    expect(selector.canFastReject).toBe(false);
  });

  test('cannot fast reject selectors with a deep :is with a selector list', async () => {
    let selector = sel([pseudo({ name: ':is', arg: sel([pseudo({ name: ':is', arg: sellist([el('.foo'), el('.bar')]) })] as any) })]);
    await selector.eval(context);
    expect(selector.keySet.equals(context.selectorBits.getBitset(['.foo', '.bar']))).toBe(true);
    expect(selector.visibleKeySet.equals(context.selectorBits.getBitset(['.foo', '.bar']))).toBe(true);
    expect(selector.canFastReject).toBe(false);
  });
});
