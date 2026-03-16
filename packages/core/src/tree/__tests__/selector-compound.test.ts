import { compound, sel, el, pseudo, type SimpleSelector } from '../index.js';
import { Context } from '../../context.js';

let context: Context;

/**
 * @todo - add tests for list bubbling
 */
describe('Compound Selector', () => {
  beforeEach(() => {
    context = new Context();
  });

  describe('equality', () => {
    test('same value', () => {
      let sel1 = (compound([
        el('a'),
        el('#id'),
        el('.class')
      ]) as any).valueOf();
      let sel2 = (compound([
        el('a'),
        el('#id'),
        el('.class')
      ]) as any).valueOf();
      expect(sel1).toEqual(sel2);
    });
  });

  describe('keys', () => {
    test('simple compound', async () => {
      let sel1 = compound([
        el('a'),
        el('#id'),
        el('.class')
      ]);
      await sel1.eval(context);
      expect(sel1.keySet.equals(context.selectorBits.getBitset(['a', '#id', '.class']))).toBe(true);
      expect(sel1.visibleKeySet.equals(context.selectorBits.getBitset(['a', '#id', '.class']))).toBe(true);
    });

    test('nested compound', async () => {
      /** :is(a)#id:is(.one.two) */
      const sel1 = pseudo({ name: ':is', arg: el('a') });
      let sel2 = compound([
        sel1,
        el('#id'),
        pseudo({ name: ':is', arg: compound([el('.two'), el('.one')]) })
      ]);

      await sel2.eval(context);
      expect(sel1.keySet.equals(context.selectorBits.getBitset(['a']))).toBe(true);
      expect(sel1.visibleKeySet.equals(context.selectorBits.getBitset(['a']))).toBe(true);
      expect(sel2.keySet.equals(context.selectorBits.getBitset(['a', '#id', '.two', '.one']))).toBe(true);
      expect(sel2.visibleKeySet.equals(context.selectorBits.getBitset(['a', '#id', '.two', '.one']))).toBe(true);
    });
  });
});
