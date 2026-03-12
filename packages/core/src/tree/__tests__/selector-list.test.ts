import { sel, sellist, el, co } from '../index.js';

/**
 * @todo - add tests for list bubbling
 */
describe('Selector list', () => {
  describe('equality', () => {
    /** @todo - add test for non-equality */
    test('basic list equality', () => {
      /** a b, a c */
      let sel1 = sellist([
        sel([
          el('a'),
          co(' '),
          el('b')
        ]),
        sel([
          el('a'),
          co(' '),
          el('c')
        ])
      ]);

      let sel2 = sellist([
        sel([
          el('a'),
          co(' '),
          el('c')
        ]),
        sel([
          el('a'),
          co(' '),
          el('b')
        ])
      ]);

      expect((sel1 as any).compare(sel2)).toBe(0);
      expect((sel2 as any).compare(sel1)).toBe(0);
    });
  });
});