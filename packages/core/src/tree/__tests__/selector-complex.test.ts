import { amp, any, attr, co, compound, ComplexSelector, el, pseudo, ref, rules, Rules, sel, sellist, vardecl } from '../index.js';
import { Context, TreeContext } from '../../context.js';
import { createTriviaMap, makeTrivia } from '../util/trivia.js';
import { OutputWriter } from '../util/print.js';
import { createRenderBuffer } from '../util/render-buffer.js';

class CountingWriter extends OutputWriter {
  captures = 0;
  reads = 0;

  override capture(fn: () => void): string {
    this.captures++;
    return super.capture(fn);
  }

  override getSince(mark: number): string {
    this.reads++;
    return super.getSince(mark);
  }
}

const run = (text: string) => makeTrivia(text, 0, text.length);

let context: Context;

async function useEvaluatedRules(node: Rules): Promise<void> {
  const evald = await node.eval(context);
  if (!(evald instanceof Rules)) {
    throw new TypeError('Expected Rules');
  }
  context.root = evald;
  context.rulesContext = evald;
}

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

    test('exposes value as direct child field', () => {
      const first = el('a');
      const combinator = co('>');
      const second = el('.foo');
      const node = sel([first, combinator, second]);

      expect(node.value).toEqual([first, combinator, second]);
      expect(node.value).toEqual([first, combinator, second]);
      expect(ComplexSelector.childKeys).toEqual(['value']);
    });

    test('writes empty complex selector syntax without writer readback', () => {
      const writer = new CountingWriter();

      expect(sel([]).toTrimmedString({ writer })).toBe('');
      expect(writer.toString()).toBe('');
      expect(writer.reads).toBe(0);
      expect(writer.captures).toBe(0);
    });

    test('streams selector value without capture scaffolding', () => {
      const writer = new CountingWriter();
      const node = sel([
        el('a'),
        co('>'),
        el('.foo')
      ]);

      expect(node.toTrimmedString({ writer })).toBe('a > .foo');
      expect(writer.captures).toBe(0);
    });

    test('does not prepend indent-breaking space before a leading combinator', () => {
      const node = sel([
        co('>'),
        el('.foo')
      ]);

      expect(node.toTrimmedString()).toBe('> .foo');
    });

    test('renders resolved complex selector values through render(context)', async () => {
      const node = rules([
        vardecl({
          name: any('attr-name'),
          value: any('foo')
        })
      ]);
      await useEvaluatedRules(node);

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

    test('writes resolved complex selector output into segmented buffers', async () => {
      const node = rules([
        vardecl({
          name: any('attr-name'),
          value: any('foo')
        })
      ]);
      await useEvaluatedRules(node);
      const buffer = createRenderBuffer('segmented');

      const selectorNode = sel([
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
      const originalResolve = selectorNode.resolve;
      let resolveCalls = 0;
      selectorNode.resolve = function countResolveCalls(
        this: typeof selectorNode,
        ...args: Parameters<typeof originalResolve>
      ): ReturnType<typeof originalResolve> {
        resolveCalls++;
        return originalResolve.apply(this, args);
      };

      const rendered = selectorNode.render(context, buffer);

      expect(rendered).toBe('a[data=foo] > .foo');
      expect(buffer.segments).toEqual(['a[data=foo] > .foo']);
      expect(resolveCalls).toBe(0);
    });

    test('does not consume reordered source trivia between generated selector parts', () => {
      const trivia = createTriviaMap({
        before: new Map([[0, run('\n')]]),
        after: new Map([[26, run('\n')]])
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
      await useEvaluatedRules(node);

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

      expect(resolved.toTrimmedString()).toBe('a[data=foo] > .foo');
      expect(selector.registrationPrepared).toBe(false);
      expect(context.printState.writer).toBeUndefined();
    });

    test('derives resolved complex selector surfaces without generic construction', async () => {
      const first = el('.source');
      const resolvedFirst = el('.resolved');
      first.resolve = () => resolvedFirst;
      const selector = sel([
        first,
        co('>'),
        el('.other')
      ]);
      const originalConstruct = Reflect.construct;
      Reflect.construct = () => {
        throw new Error('complex selector resolve should not use generic construction');
      };

      try {
        const resolved = await selector.resolve(context);

        expect(resolved.toTrimmedString()).toBe('.resolved > .other');
        expect(first.parent).toBe(selector);
      } finally {
        Reflect.construct = originalConstruct;
      }
    });

    test('keeps source complex selector values canonical after resolve(context)', async () => {
      const node = rules([
        vardecl({
          name: any('attr-name'),
          value: any('foo')
        })
      ]);
      await useEvaluatedRules(node);

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

      expect(resolved.render(context)).toBe('a[data=foo] > .foo');
      expect(sourceCompound.parent).toBe(selector);
      expect(sourceCombinator.parent).toBe(selector);
      expect(sourceChild.parent).toBe(selector);
      expect(selector.toTrimmedString()).toBe('a[data=$attr-name] > .foo');
    });

    test('keeps source complex child canonical when eval collapses to one selector', async () => {
      const selector = sel([
        amp(),
        el('.keep')
      ]);
      const sourceChild = selector.value[1]!;
      const sourceParent = sourceChild.parent;
      const sourceLocation = sourceChild.location;
      const resolved = await selector.eval(context);

      expect(resolved.toTrimmedString()).toBe('.keep');
      expect(resolved).not.toBe(sourceChild);
      expect(sourceChild.parent).toBe(sourceParent);
      expect(sourceChild.location).toBe(sourceLocation);
      expect(selector.toTrimmedString()).toBe('&.keep');
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

    test('string-backed complex', async () => {
      const sel1 = sel(['.one', '>', '.two', '+', 'div']);
      await sel1.eval(context);
      expect(sel1.toTrimmedString()).toBe('.one > .two + div');
      expect(sel1.keySet.equals(context.selectorBits.getBitset(['.one', '>', '.two', '+', 'div']))).toBe(true);
      expect(sel1.visibleKeySet.equals(context.selectorBits.getBitset(['.one', '.two', 'div']))).toBe(true);
      expect(sel1.requiredKeySet.equals(context.selectorBits.getBitset(['.one', '>', '.two', '+', 'div']))).toBe(true);
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
