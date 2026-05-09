import type { IToken } from 'chevrotain';
import { any, attr, co, compound, el, pseudo, ref, rules, sel, sellist, type Rules as RulesClass, vardecl } from '../index.js';
import { Context, TreeContext } from '../../context.js';
import { createTriviaMap } from '../util/trivia.js';
import { OutputWriter } from '../util/print.js';

class CountingWriter extends OutputWriter {
  captures = 0;

  override capture(fn: () => void): string {
    this.captures++;
    return super.capture(fn);
  }
}

const token = (image: string): IToken => ({
  image,
  tokenType: { name: 'WS' } as IToken['tokenType'],
  startOffset: 0,
  endOffset: image.length - 1,
  startLine: 1,
  endLine: 1,
  startColumn: 1,
  endColumn: image.length
});

let context: Context;

describe('Complex selector', () => {
  beforeEach(() => {
    context = new Context();
  });

  describe('render', () => {
    test('renders complex selector syntax through toTrimmedString()', () => {
      const node = sel([
        el('a'),
        co('>'),
        el('.foo')
      ]);

      expect(node.toTrimmedString()).toBe('a > .foo');
    });

    test('streams selector components without capture scaffolding', () => {
      const writer = new CountingWriter();
      const node = sel([
        el('a'),
        co('>'),
        el('.foo')
      ]);

      expect(node.toTrimmedString({ writer })).toBe('a > .foo');
      expect(writer.captures).toBe(0);
    });

    test('renders resolved complex selector values through render(context)', async () => {
      const node = rules([
        vardecl({
          name: any('attr-name'),
          value: any('foo')
        })
      ]);
      const evald = await node.eval(context);
      context.root = evald as RulesClass;
      context.rulesContext = evald as RulesClass;

      const rendered = sel([
        compound([
          el('a'),
          attr({
            name: 'data',
            op: '=',
            value: ref({ key: 'attr-name' }, { type: 'variable' })
          })
        ]),
        co('>'),
        el('.foo')
      ]).render(context);

      expect(rendered).toBe('a[data=foo] > .foo');
    });

    test('does not consume reordered source trivia between generated selector parts', () => {
      const trivia = createTriviaMap({
        before: new Map([[0, [token('\n')]]]),
        after: new Map([[26, [token('\n')]]])
      });
      const treeContext = new TreeContext({ trivia });
      const parent = el('.top', undefined, [0, 1, 1, 3, 1, 4], treeContext);
      const nested = el('.inside', undefined, [20, 2, 3, 26, 2, 10], treeContext);

      const rendered = sel([
        nested,
        co(' '),
        parent
      ]).render(context);

      expect(rendered).toBe('.inside .top');
    });

    test('resolves complex selector values without touching render state', async () => {
      const node = rules([
        vardecl({
          name: any('attr-name'),
          value: any('foo')
        })
      ]);
      const evald = await node.eval(context);
      context.root = evald as RulesClass;
      context.rulesContext = evald as RulesClass;

      const selector = sel([
        compound([
          el('a'),
          attr({
            name: 'data',
            op: '=',
            value: ref({ key: 'attr-name' }, { type: 'variable' })
          })
        ]),
        co('>'),
        el('.foo')
      ]);

      const resolved = await selector.resolve(context);

      expect(`${resolved}`).toBe('a[data=foo] > .foo');
      expect(selector.evaluated).toBe(false);
      expect(selector.preEvaluated).toBe(false);
      expect(context.printState.writer).toBeUndefined();
    });

    test('keeps source complex selector values canonical after resolve(context)', async () => {
      const node = rules([
        vardecl({
          name: any('attr-name'),
          value: any('foo')
        })
      ]);
      const evald = await node.eval(context);
      context.root = evald as RulesClass;
      context.rulesContext = evald as RulesClass;

      const selector = sel([
        compound([
          el('a'),
          attr({
            name: 'data',
            op: '=',
            value: ref({ key: 'attr-name' }, { type: 'variable' })
          })
        ]),
        co('>'),
        el('.foo')
      ]);
      const sourceCompound = selector.value[0]!;
      const sourceCombinator = selector.value[1]!;
      const sourceChild = selector.value[2]!;
      const resolved = await selector.resolve(context);

      expect(`${resolved}`).toBe('a[data=foo] > .foo');
      expect(sourceCompound.parent).toBe(selector);
      expect(sourceCombinator.parent).toBe(selector);
      expect(sourceChild.parent).toBe(selector);
      expect(selector.toTrimmedString()).toBe('a[data=$attr-name] > .foo');
    });
  });

  describe('keys', () => {
    test('simple complex', async () => {
      let sel1 = sel([
        compound([
          el('.one'),
          el('.two')
        ]),
        co('>'),
        el('.three')
      ]);
      await sel1.eval(context);
      expect(sel1.keySet.equals(context.selectorBits.getBitset(['.one', '.two', '>', '.three']))).toBe(true);
      // visibleKeySet excludes combinators
      expect(sel1.visibleKeySet.equals(context.selectorBits.getBitset(['.one', '.two', '.three']))).toBe(true);
    });
    test('nested complex (w/ relative :is)', async () => {
      let sel2 = sel([
        compound([
          pseudo({ name: ':is', arg: el('a') }),
          el('#id'),
          pseudo({ name: ':is', arg: sel([co('>'), compound([el('.two'), el('.one')])]) })
        ])
      ]);
      await sel2.eval(context);
      expect(sel2.keySet.equals(context.selectorBits.getBitset(['a', '#id', '>', '.two', '.one']))).toBe(true);
      // visibleKeySet excludes combinators (even those inside :is() complex args)
      expect(sel2.visibleKeySet.equals(context.selectorBits.getBitset(['a', '#id', '.two', '.one']))).toBe(true);
    });
    test('nested complex (w/o relative :is)', async () => {
      let sel2 = sel([
        compound([
          pseudo({ name: ':is', arg: el('a') }),
          el('#id'),
          pseudo({ name: ':is', arg: sel([compound([el('.two'), el('.one')])]) })
        ])
      ]);
      await sel2.eval(context);
      expect(sel2.keySet.equals(context.selectorBits.getBitset(['a', '#id', '.two', '.one']))).toBe(true);
      expect(sel2.visibleKeySet.equals(context.selectorBits.getBitset(['a', '#id', '.two', '.one']))).toBe(true);
    });
    test(':is w/ selector list', async () => {
      let sel2 = sel([
        compound([
          pseudo({ name: ':is', arg: sellist([el('a'), el('b')]) }),
          el('#id'),
          pseudo({ name: ':is', arg: sel([compound([el('.two'), el('.one')])]) })
        ])
      ]);
      await sel2.eval(context);
      expect(sel2.keySet.equals(context.selectorBits.getBitset(['a', 'b', '#id', '.two', '.one']))).toBe(true);
      expect(sel2.visibleKeySet.equals(context.selectorBits.getBitset(['a', 'b', '#id', '.two', '.one']))).toBe(true);
    });

    test(':is w/ complex selector list', async () => {
      let sel2 = sel([
        compound([
          pseudo({
            name: ':is',
            arg: sellist([
              sel([el('a'), co('>'), el('b')]),
              sel([el('c'), co('>'), el('d')])
            ])
          }),
          el('#id'),
          pseudo({ name: ':is', arg: sel([compound([el('.two'), el('.one')])]) })
        ])
      ]);
      await sel2.eval(context);
      expect(sel2.keySet.equals(context.selectorBits.getBitset(['a', 'b', 'c', 'd', '#id', '>', '.two', '.one']))).toBe(true);
      // visibleKeySet excludes combinators (including those inside :is() complex args)
      expect(sel2.visibleKeySet.equals(context.selectorBits.getBitset(['a', 'b', 'c', 'd', '#id', '.two', '.one']))).toBe(true);
    });
  });
});
