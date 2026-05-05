import type { IToken } from 'chevrotain';
import { any, attr, compound, el, pseudo, ref, rules, type Rules as RulesClass, vardecl } from '../index.js';
import { Context } from '../../context.js';
import type { TriviaMap } from '../../types/index.js';
import { createTriviaMap } from '../util/trivia.js';
import { OutputWriter } from '../util/print.js';

const token = (image: string, tokenTypeName = 'WS'): IToken => ({
  image,
  tokenType: { name: tokenTypeName } as IToken['tokenType'],
  startOffset: 0,
  endOffset: image.length - 1,
  startLine: 1,
  endLine: 1,
  startColumn: 1,
  endColumn: image.length
});

class CountingWriter extends OutputWriter {
  captures = 0;

  override capture(fn: () => void): string {
    this.captures++;
    return super.capture(fn);
  }
}

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

    test('streams compound selector parts without capture scaffolding', () => {
      const writer = new CountingWriter();
      const first = el('.sel');
      first._location = [0, 1, 1, 3, 1, 4];
      const second = el('.a');
      second._location = [16, 1, 17, 17, 1, 18];
      const trivia = createTriviaMap({
        before: new Map([[second.location[0], [token('/*comment*/', 'BlockComment')]]]),
        after: new Map<number, IToken[]>()
      }) satisfies TriviaMap;

      expect(compound([first, second]).toString({ trivia, writer })).toBe('.sel/*comment*/.a');
      expect(writer.captures).toBe(0);
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
