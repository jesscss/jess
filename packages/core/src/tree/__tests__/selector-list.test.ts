import { any, attr, co, compound, el, ref, rules, sel, sellist, type Rules as RulesClass, vardecl } from '../index.js';
import { Context } from '../../context.js';

/**
 * @todo - add tests for list bubbling
 */
describe('Selector list', () => {
  let context: Context;

  beforeEach(() => {
    context = new Context();
  });

  describe('equality', () => {
    test('renders selector-list syntax through toTrimmedString()', () => {
      const node = sellist([
        el('.foo'),
        el('.bar')
      ]);

      expect(node.toTrimmedString()).toBe('.foo,\n.bar');
    });

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

      expect(sel1.compare(sel2)).toBe(0);
      expect(sel2.compare(sel1)).toBe(0);
    });
  });

  test('renders resolved selector-list values through render(context)', async () => {
    const node = rules([
      vardecl({
        name: any('attr-name'),
        value: any('foo')
      })
    ]);
    const evald = await node.eval(context);
    context.root = evald as RulesClass;
    context.rulesContext = evald as RulesClass;

    const rendered = sellist([
      compound([
        el('a'),
        attr({
          name: 'data',
          op: '=',
          value: ref({ key: 'attr-name' }, { type: 'variable' })
        })
      ]),
      el('.bar')
    ]).render(context);

    expect(rendered).toBe('a[data=foo],\n.bar');
  });

  test('resolves selector-list values without touching render state', async () => {
    const node = rules([
      vardecl({
        name: any('attr-name'),
        value: any('foo')
      })
    ]);
    const evald = await node.eval(context);
    context.root = evald as RulesClass;
    context.rulesContext = evald as RulesClass;

    const selector = sellist([
      compound([
        el('a'),
        attr({
          name: 'data',
          op: '=',
          value: ref({ key: 'attr-name' }, { type: 'variable' })
        })
      ]),
      el('.bar')
    ]);

    const resolved = await selector.resolve(context);

    expect(`${resolved}`).toBe('a[data=foo],\n.bar');
    expect(selector.evaluated).toBe(false);
    expect(selector.preEvaluated).toBe(false);
    expect(context.printState.writer).toBeUndefined();
  });
});
