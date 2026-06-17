import { any, attr, co, compound, el, pseudo, ref, rules, Rules as RulesClass, sel, sellist, vardecl } from '../index.js';
import { Context } from '../../context.js';
import { createRenderBuffer } from '../util/render-buffer.js';
import { OutputWriter } from '../util/print.js';
import { F_EXTENDED, F_EXTEND_TARGET } from '../node.js';

class CountingWriter extends OutputWriter {
  reads = 0;

  override getSince(mark: number): string {
    this.reads++;
    return super.getSince(mark);
  }
}

/**
 * @todo - add tests for list bubbling
 */
describe('Selector list', () => {
  let context: Context;

  beforeEach(() => {
    context = new Context();
  });

  const setRoot = (node: unknown) => {
    if (!(node instanceof RulesClass)) {
      throw new TypeError('Expected evaluated rules root');
    }
    context.root = node;
    context.rulesContext = node;
  };

  describe('equality', () => {
    test('renders selector-list syntax through toTrimmedString()', () => {
      const node = sellist([
        el('.foo'),
        el('.bar')
      ]);

      expect(node.toTrimmedString()).toBe('.foo,\n.bar');
    });

    test('writes empty selector-list syntax without writer readback', () => {
      const writer = new CountingWriter();

      expect(sellist([]).toTrimmedString({ writer })).toBe('');
      expect(writer.toString()).toBe('');
      expect(writer.reads).toBe(0);
    });

    test('writes top-level :is selector-list items directly', () => {
      const node = sellist([
        pseudo({
          name: ':is',
          arg: sellist([el('.a'), el('.b')])
        }),
        el('.c')
      ]);

      expect(node.toTrimmedString()).toBe('.a,\n.b,\n.c');
    });

    test('filters flattened reference-mode selector-list items directly', () => {
      const target = el('.target');
      target.addFlag(F_EXTENDED);
      target.addFlag(F_EXTEND_TARGET);
      const added = el('.added');
      added.addFlag(F_EXTENDED);
      const node = sellist([
        pseudo({
          name: ':is',
          arg: sellist([target, added])
        }),
        el('.plain')
      ]);

      expect(node.toTrimmedString({
        referenceMode: true,
        referenceRenderEnabled: true,
        referenceFilterTargets: true
      })).toBe('.added');
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
    setRoot(evald);

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

  test('writes resolved selector-list output into segmented buffers', async () => {
    const node = rules([
      vardecl({
        name: any('attr-name'),
        value: any('foo')
      })
    ]);
    const evald = await node.eval(context);
    setRoot(evald);
    const buffer = createRenderBuffer('segmented');

    const selectorNode = sellist([
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

    expect(rendered).toBe('a[data=foo],\n.bar');
    expect(buffer.segments).toEqual(['a[data=foo],\n.bar']);
    expect(resolveCalls).toBe(0);
  });

  test('resolves selector-list values without touching render state', async () => {
    const node = rules([
      vardecl({
        name: any('attr-name'),
        value: any('foo')
      })
    ]);
    const evald = await node.eval(context);
    setRoot(evald);

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

    expect(resolved.toTrimmedString()).toBe('a[data=foo],\n.bar');
    expect(selector.evaluated).toBe(false);
    expect(selector.registrationPrepared).toBe(false);
    expect(context.printState.writer).toBeUndefined();
  });

  test('keeps unchanged multi-selector evaluation on the source list', async () => {
    const selector = sellist([
      el('.foo'),
      el('.bar')
    ]);

    const evaluated = await selector.eval(context);
    const resolved = await selector.resolve(context);

    expect(evaluated).toBe(selector);
    expect(resolved).toBe(selector);
  });

  test('still collapses unchanged single-selector evaluation', async () => {
    const selector = sellist([el('.solo')]);
    const evaluated = await selector.eval(context);

    expect(evaluated).not.toBe(selector);
    expect(evaluated.toTrimmedString()).toBe('.solo');
  });

  test('still materializes unchanged top-level selector-list flattening', async () => {
    const selector = sellist([
      pseudo({
        name: ':is',
        arg: sellist([el('.a'), el('.b')])
      }),
      el('.c')
    ]);
    const evaluated = await selector.eval(context);

    expect(evaluated).not.toBe(selector);
    expect(evaluated.toTrimmedString()).toBe('.a,\n.b,\n.c');
  });

  test('derives resolved selector-list surfaces without generic construction', async () => {
    const first = el('.source');
    const resolvedFirst = el('.resolved');
    first.resolve = () => resolvedFirst;
    const selector = sellist([
      first,
      el('.other')
    ]);
    const originalConstruct = Reflect.construct;
    Reflect.construct = () => {
      throw new Error('selector-list resolve should not use generic construction');
    };

    try {
      const resolved = await selector.resolve(context);

      expect(resolved.toTrimmedString()).toBe('.resolved,\n.other');
      expect(first.parent).toBe(selector);
    } finally {
      Reflect.construct = originalConstruct;
    }
  });

  test('keeps source selector-list values canonical after resolve(context)', async () => {
    const node = rules([
      vardecl({
        name: any('attr-name'),
        value: any('foo')
      })
    ]);
    const evald = await node.eval(context);
    setRoot(evald);

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
    const sourceFirst = selector.value[0]!;
    const sourceSecond = selector.value[1]!;
    const resolved = await selector.resolve(context);

    expect(resolved.render(context)).toBe('a[data=foo],\n.bar');
    expect(sourceFirst.parent).toBe(selector);
    expect(sourceSecond.parent).toBe(selector);
    expect(selector.toTrimmedString()).toBe('a[data=$attr-name],\n.bar');
  });

  test('owns single resolved selector-list output without reparenting the source child', async () => {
    const inner = sellist([sel([el('.source'), co(' '), el('.child')])]);
    const sourceChild = inner.value[0]!;
    const selector = pseudo({ name: ':is', arg: inner });

    const resolved = await selector.resolve(context);
    const resolvedArg = resolved.value.arg;

    expect(resolved.toTrimmedString()).toBe(':is(.source .child)');
    expect(resolvedArg).not.toBe(sourceChild);
    expect(sourceChild.parent).toBe(inner);
    expect(inner.parent).toBe(selector);
  });
});
