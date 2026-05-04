import { any, attr, compound, el, pseudo, ref, rules, type Rules as RulesClass, vardecl } from '../index.js';
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
    test('renders compound selector syntax through toTrimmedString()', () => {
      const node = compound([
        el('a'),
        attr({
          name: 'data',
          op: '=',
          value: any('bar')
        })
      ]);

      expect(node.toTrimmedString()).toBe('a[data=bar]');
    });

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

  test('renders resolved compound selector values through render(context)', async () => {
    const node = rules([
      vardecl({
        name: any('capture-attr'),
        value: any('foo')
      })
    ]);
    const evald = await node.eval(context);
    context.root = evald as RulesClass;
    context.rulesContext = evald as RulesClass;

    const rendered = compound([
      el('a'),
      attr({
        name: 'data',
        op: '=',
        value: ref({ key: 'capture-attr' }, { type: 'variable' })
      })
    ]).render(context);

    expect(rendered).toBe('a[data=foo]');
  });

  test('resolves compound selector values without touching render state', async () => {
    const node = rules([
      vardecl({
        name: any('capture-attr'),
        value: any('foo')
      })
    ]);
    const evald = await node.eval(context);
    context.root = evald as RulesClass;
    context.rulesContext = evald as RulesClass;

    const selector = compound([
      el('a'),
      attr({
        name: 'data',
        op: '=',
        value: ref({ key: 'capture-attr' }, { type: 'variable' })
      })
    ]);

    const resolved = await selector.resolve(context);

    expect(`${resolved}`).toBe('a[data=foo]');
    expect(selector.evaluated).toBe(false);
    expect(selector.preEvaluated).toBe(false);
    expect(context.printState.writer).toBeUndefined();
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
