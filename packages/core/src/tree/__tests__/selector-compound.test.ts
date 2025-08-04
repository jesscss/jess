import { compound, sel, el, pseudo, type SimpleSelector } from '..';

/**
 * @todo - add tests for list bubbling
 */
describe('Compound Selector', () => {
  describe('equality', () => {
    test('same value', () => {
      let sel1 = compound([
        el('a'),
        el('#id'),
        el('.class')
      ]).valueOf();
      let sel2 = compound([
        el('a'),
        el('#id'),
        el('.class')
      ]).valueOf();
      expect(sel1).toEqual(sel2);
    });
  });

  describe('keys', () => {
    test('simple compound', () => {
      let sel1 = compound([
        el('a'),
        el('#id'),
        el('.class')
      ]);
      expect([...sel1.keySet]).toEqual(['a', '#id', '.class']);
    });

    test('nested compound', () => {
      /** :is(a)#id:is(.one.two) */
      const sel1 = pseudo({ name: ':is', arg: el('a') });
      let sel2 = compound([
        sel1,
        el('#id'),
        pseudo({ name: ':is', arg: compound([el('.two'), el('.one')]) })
      ]);

      expect([...sel1.keySet]).toEqual(['a']);
      expect([...sel2.keySet]).toEqual(['a', '#id', '.two', '.one']);
    });
  });
});