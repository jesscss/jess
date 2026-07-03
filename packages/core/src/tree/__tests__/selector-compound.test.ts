import { amp, any, attr, compound, CompoundSelector, el, pseudo, ref, rules, Rules, vardecl } from '../index.js';
import { keySetOf, visibleKeySetOf, requiredKeySetOf } from '../util/selector-analysis.js';
import { Context } from '../../context.js';
import type { Trivia, TriviaMap } from '../../types/index.js';
import { createTriviaMap, makeTrivia } from '../util/trivia.js';
import { OutputWriter } from '../util/print.js';
import { createRenderBuffer } from '../util/render-buffer.js';

const run = (text: string): Trivia => makeTrivia(text, 0, text.length);

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

let context: Context;

async function useEvaluatedRules(node: Rules): Promise<void> {
  const evald = await node.eval(context);
  if (!(evald instanceof Rules)) {
    throw new TypeError('Expected Rules');
  }
  context.root = evald;
  context.rulesContext = evald;
}

/**
 * @todo - add tests for list bubbling
 */
describe('Compound Selector', () => {
  beforeEach(() => {
    context = new Context();
  });

  describe('equality', () => {
    test('exposes value as the direct child field', () => {
      const first = el('.foo');
      const second = el('.bar');
      const node = compound([first, second]);

      expect(node.value).toEqual([first, second]);
      expect(node.value).toEqual([first, second]);
      expect(CompoundSelector.childKeys).toEqual(['value']);
    });

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

    test('writes empty compound selector syntax without writer readback', () => {
      const writer = new CountingWriter();

      expect(compound([]).toTrimmedString({ writer })).toBe('');
      expect(writer.toString()).toBe('');
      expect(writer.reads).toBe(0);
      expect(writer.captures).toBe(0);
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
        before: new Map([[second.location[0], run('/*comment*/')]]),
        after: new Map<number, Trivia>()
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
    await useEvaluatedRules(node);

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

  test('writes resolved compound selector output into segmented buffers', async () => {
    const node = rules([
      vardecl({
        name: any('capture-attr'),
        value: any('foo')
      })
    ]);
    await useEvaluatedRules(node);
    const buffer = createRenderBuffer('segmented');

    const selectorNode = compound([
      el('a'),
      attr({
        name: 'data',
        op: '=',
        value: ref({ key: 'capture-attr' }, { type: 'variable' })
      })
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

    expect(rendered).toBe('a[data=foo]');
    expect(buffer.segments).toEqual(['a[data=foo]']);
    expect(resolveCalls).toBe(0);
  });

  test('resolves compound selector values without touching render state', async () => {
    const node = rules([
      vardecl({
        name: any('capture-attr'),
        value: any('foo')
      })
    ]);
    await useEvaluatedRules(node);

    const selector = compound([
      el('a'),
      attr({
        name: 'data',
        op: '=',
        value: ref({ key: 'capture-attr' }, { type: 'variable' })
      })
    ]);

    const resolved = await selector.resolve(context);

    expect(resolved.toTrimmedString()).toBe('a[data=foo]');
    expect(selector.registrationPrepared).toBe(false);
    expect(context.printState.writer).toBeUndefined();
  });

  test('derives resolved compound selector surfaces without generic construction', async () => {
    const first = el('.source');
    const resolvedFirst = el('.resolved');
    first.resolve = () => resolvedFirst;
    const selector = compound([
      first,
      el('.other')
    ]);
    const originalConstruct = Reflect.construct;
    Reflect.construct = () => {
      throw new Error('compound selector resolve should not use generic construction');
    };

    try {
      const resolved = await selector.resolve(context);

      expect(resolved.toTrimmedString()).toBe('.resolved.other');
      expect(first.parent).toBe(selector);
    } finally {
      Reflect.construct = originalConstruct;
    }
  });

  test('keeps source compound selector values canonical after resolve(context)', async () => {
    const node = rules([
      vardecl({
        name: any('capture-attr'),
        value: any('foo')
      })
    ]);
    await useEvaluatedRules(node);

    const selector = compound([
      el('a'),
      attr({
        name: 'data',
        op: '=',
        value: ref({ key: 'capture-attr' }, { type: 'variable' })
      })
    ]);
    const sourceElement = selector.value[0]!;
    const sourceAttr = selector.value[1]!;
    const resolved = await selector.resolve(context);

    expect(resolved.render(context)).toBe('a[data=foo]');
    expect(sourceElement.parent).toBe(selector);
    expect(sourceAttr.parent).toBe(selector);
    expect(selector.toTrimmedString()).toBe('a[data=$capture-attr]');
  });

  test('keeps source compound child canonical when eval collapses to one selector', async () => {
    const selector = compound([
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

  describe('keys', () => {
    test('simple compound', async () => {
      let sel1 = compound([
        el('a'),
        el('#id'),
        el('.class')
      ]);
      await sel1.eval(context);
      expect(keySetOf(sel1).equals(context.selectorBits.getBitset(['a', '#id', '.class']))).toBe(true);
      expect(visibleKeySetOf(sel1).equals(context.selectorBits.getBitset(['a', '#id', '.class']))).toBe(true);
    });

    test('string-backed compound', async () => {
      const sel1 = compound(['a', '#id', '.class']);
      await sel1.eval(context);
      expect(sel1.toTrimmedString()).toBe('a#id.class');
      expect(keySetOf(sel1).equals(context.selectorBits.getBitset(['a', '#id', '.class']))).toBe(true);
      expect(visibleKeySetOf(sel1).equals(context.selectorBits.getBitset(['a', '#id', '.class']))).toBe(true);
      expect(requiredKeySetOf(sel1).equals(context.selectorBits.getBitset(['a', '#id', '.class']))).toBe(true);
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
      expect(keySetOf(sel1).equals(context.selectorBits.getBitset(['a']))).toBe(true);
      expect(visibleKeySetOf(sel1).equals(context.selectorBits.getBitset(['a']))).toBe(true);
      expect(keySetOf(sel2).equals(context.selectorBits.getBitset(['a', '#id', '.two', '.one']))).toBe(true);
      expect(visibleKeySetOf(sel2).equals(context.selectorBits.getBitset(['a', '#id', '.two', '.one']))).toBe(true);
    });
  });
});
