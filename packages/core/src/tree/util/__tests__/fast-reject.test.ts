import { compound, el, sel, pseudo, co, num, sellist, type ComplexSelector } from '../../index.js';
import { Context } from '../../../context.js';

describe('BitSets and selectors', () => {
  let context: Context;
  beforeEach(() => {
    context = new Context();
  });

  it('fast rejects simple selectors', async () => {
    let selector = el('.foo');
    selector.eval(context);
    /** Keysets are lazy-loaded */
    selector.keySet;
    expect(selector.canFastReject).toBe(true);
  });

  it('fast rejects compound selectors with simples', async () => {
    let selector = compound([el('.foo'), el('.bar')]);
    await selector.eval(context);
    selector.keySet;
    expect(selector.canFastReject).toBe(true);
  });

  it('fast rejects complex selectors with simples', async () => {
    let selector = sel([el('.foo'), co(' '), el('.bar')]);
    await selector.eval(context);
    selector.keySet;
    expect(selector.canFastReject).toBe(true);
  });

  it('fast rejects complex selectors with compounds', async () => {
    let selector = sel([compound([el('a'), el('.foo')]), co(' '), el('.bar')]);
    await selector.eval(context);
    selector.keySet;
    expect(selector.canFastReject).toBe(true);
  });

  test('fast rejects :is selectors with simple selectors', async () => {
    let selector = sel([pseudo({ name: ':is', arg: el('.foo') })]);
    await selector.eval(context);
    selector.keySet;
    expect(selector.canFastReject).toBe(true);
  });

  test('cannot fast reject :is selectors with selector lists', async () => {
    let selector = sel([pseudo({ name: ':is', arg: sellist([el('.foo'), el('.bar')]) })]);
    await selector.eval(context);
    selector.keySet;
    expect(selector.canFastReject).toBe(false);
  });

  test('cannot fast reject selectors with a deep :is with a selector list', async () => {
    let selector = sel([pseudo({ name: ':is', arg: sel([pseudo({ name: ':is', arg: sellist([el('.foo'), el('.bar')]) })] as any) })]);
    await selector.eval(context);
    selector.keySet;
    expect(selector.canFastReject).toBe(false);
  });

  // test('other pseudo selectors get added to keyset', async () => {
  //   let library = context.selectorBits;
  //   let selector = sel([pseudo({ name: ':not', arg: el('.foo') })]);
  //   await selector.eval(context);
  //   selector.keySet;
  //   expect(library.size).toBe(2);
  //   expect(library.has('.foo')).toBe(true);
  //   expect(library.has(':not')).toBe(true);
  // });

  // test('nth selectors', async () => {
  //   let library = context.selectorBits;
  //   let sel = pseudo({ name: ':nth-child', arg: num(1) });
  //   await sel.eval(context);
  //   sel.keySet;
  //   expect(library.size).toBe(1);
  //   expect(library.has(':nth-child(1)')).toBe(true);
  // });
});