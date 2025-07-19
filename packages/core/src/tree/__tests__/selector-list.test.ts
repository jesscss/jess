import { sel, sellist, el, co } from '..';

/**
 * @todo - add tests for list bubbling
 */
describe('Selector list', () => {
  describe('normalization', () => {
    test('combine lists', () => {
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
      ]).valueOf();

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
      ]).valueOf();

      expect(sel1).toEqual(sel2);
      expect(sel1).toEqual('a b,a c');
    });
  });
});