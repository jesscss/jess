import { sel, sellist, el, co, pseudo } from '../index.js';
import { Context } from '../../context.js';

/**
 * @todo - add tests for list bubbling
 */
describe('Selector list', () => {
  const context = new Context();

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

  describe('evaluation', () => {
    test('flattens top-level :is() items during eval', async () => {
      const node = sellist([
        pseudo({
          name: ':is',
          arg: sellist([el('.a'), el('.b')])
        })
      ]);

      const evald = await node.eval(context);

      expect(evald.toTrimmedString()).toBe('.a,\n.b');
    });
  });
});
