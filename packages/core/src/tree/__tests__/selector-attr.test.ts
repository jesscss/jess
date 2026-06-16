import { attr, any, quoted, mixin, rules, ruleset, decl, call, ref, list, el, vardecl } from '../index.js';
import { Context } from '../../context.js';
import { createRenderBuffer, renderNodeToString } from '../util/render-buffer.js';
import { OutputWriter } from '../util/print.js';

let context: Context;

class CountingWriter extends OutputWriter {
  marks = 0;
  reads = 0;

  override mark(): number {
    this.marks++;
    return super.mark();
  }

  override getSince(mark: number): string {
    this.reads++;
    return super.getSince(mark);
  }
}

describe('Attribute Selector', () => {
  beforeEach(() => {
    context = new Context();
  });

  describe('normalization', () => {
    test('renders attribute selector syntax through toTrimmedString()', () => {
      const rule = attr({
        name: 'data',
        op: '=',
        value: quoted('bar')
      });

      expect(rule.toTrimmedString()).toBe('[data="bar"]');
    });

    test('writes bare attribute selector syntax without writer readback', () => {
      const writer = new CountingWriter();

      expect(attr({ name: 'data' }).toTrimmedString({ writer })).toBe('[data]');
      expect(writer.toString()).toBe('[data]');
      expect(writer.reads).toBe(0);
    });

    test('renders bare attribute selector syntax without writer readback', () => {
      const writer = new CountingWriter();
      const buffer = createRenderBuffer('flat');
      const attrNode = attr({ name: 'data' });

      expect(attrNode.render(context, { writer })).toBe('[data]');
      expect(writer.toString()).toBe('[data]');
      expect(writer.marks).toBe(0);
      expect(writer.reads).toBe(0);
      expect(attrNode.render(context, buffer, { writer })).toBe('[data]');
      expect(buffer.parts).toEqual(['[data]']);
      expect(writer.marks).toBe(0);
      expect(writer.reads).toBe(0);
    });

    test('with or without quotes', () => {
      let rule1 = attr({
        name: 'foo',
        op: '=',
        value: any('bar')
      });

      expect(rule1.toString()).toBe('[foo=bar]');

      let rule2 = attr({
        name: 'FOO',
        op: '=',
        value: quoted('bar')
      });

      expect(rule2.toString()).toBe('[FOO="bar"]');
      expect(rule1.valueOf()).toBe(rule2.valueOf());
    });

    test('writes scalar non-bare attribute selector syntax without writer readback', () => {
      const anyWriter = new CountingWriter();
      const quotedWriter = new CountingWriter();
      const modWriter = new CountingWriter();

      expect(attr({ name: 'foo', op: '=', value: any('bar') }).toTrimmedString({ writer: anyWriter }))
        .toBe('[foo=bar]');
      expect(anyWriter.toString()).toBe('[foo=bar]');
      expect(anyWriter.marks).toBe(0);
      expect(anyWriter.reads).toBe(0);

      expect(attr({ name: 'foo', op: '=', value: quoted('bar') }).toTrimmedString({ writer: quotedWriter }))
        .toBe('[foo="bar"]');
      expect(quotedWriter.toString()).toBe('[foo="bar"]');
      expect(quotedWriter.marks).toBe(0);
      expect(quotedWriter.reads).toBe(0);

      expect(attr({ name: 'foo', op: '=', value: any('bar'), mod: 'i' }).toTrimmedString({ writer: modWriter }))
        .toBe('[foo=bar i]');
      expect(modWriter.toString()).toBe('[foo=bar i]');
      expect(modWriter.marks).toBe(0);
      expect(modWriter.reads).toBe(0);
    });
  });

  test('renders resolved attribute selector values through render(context)', async () => {
    const node = rules([
      vardecl({
        name: 'attr-data',
        value: any('foo')
      })
    ]);
    const evald = await node.eval(context);
    context.root = evald;
    context.rulesContext = evald;

    const attrNode = attr({
      name: 'data',
      op: '=',
      value: ref({ key: 'attr-data' }, { type: 'variable' })
    });
    const rendered = attrNode.render(context);

    expect(rendered).toBe('[data=foo]');
    expect(attrNode.evaluated).toBe(false);
    expect(attrNode.registrationPrepared).toBe(false);
  });

  test('renders resolved scalar attribute selector values without writer readback', async () => {
    const writer = new CountingWriter();
    const buffer = createRenderBuffer('flat');
    const node = rules([
      vardecl({
        name: 'attr-data',
        value: any('foo')
      })
    ]);
    const evald = await node.eval(context);
    context.root = evald;
    context.rulesContext = evald;

    const attrNode = attr({
      name: 'data',
      op: '=',
      value: ref({ key: 'attr-data' }, { type: 'variable' })
    });

    expect(attrNode.render(context, { writer })).toBe('[data=foo]');
    expect(writer.toString()).toBe('[data=foo]');
    expect(writer.marks).toBe(0);
    expect(writer.reads).toBe(0);
    expect(attrNode.render(context, buffer)).toBe('[data=foo]');
    expect(buffer.parts).toEqual(['[data=foo]']);
  });

  test('writes resolved attribute selector output into segmented buffers', async () => {
    const node = rules([
      vardecl({
        name: 'attr-data',
        value: any('foo')
      })
    ]);
    const evald = await node.eval(context);
    context.root = evald;
    context.rulesContext = evald;
    const buffer = createRenderBuffer('segmented');

    const attrNode = attr({
      name: 'data',
      op: '=',
      value: ref({ key: 'attr-data' }, { type: 'variable' })
    });
    const originalResolve = attrNode.resolve;
    let resolveCalls = 0;
    attrNode.resolve = function countResolveCalls(
      this: typeof attrNode,
      ...args: Parameters<typeof originalResolve>
    ): ReturnType<typeof originalResolve> {
      resolveCalls++;
      return originalResolve.apply(this, args);
    };
    const rendered = attrNode.render(context, buffer);

    expect(rendered).toBe('[data=foo]');
    expect(buffer.segments).toEqual(['[data=foo]']);
    expect(resolveCalls).toBe(0);
    expect(attrNode.evaluated).toBe(false);
    expect(attrNode.registrationPrepared).toBe(false);
  });

  test('resolves attribute selector values without touching render state', async () => {
    const node = rules([
      vardecl({
        name: 'attr-data',
        value: any('foo')
      })
    ]);
    const evald = await node.eval(context);
    context.root = evald;
    context.rulesContext = evald;

    const attrNode = attr({
      name: 'data',
      op: '=',
      value: ref({ key: 'attr-data' }, { type: 'variable' })
    });
    const resolved = await attrNode.resolve(context);

    expect(resolved.toTrimmedString()).toBe('[data=foo]');
    expect(attrNode.evaluated).toBe(false);
    expect(attrNode.registrationPrepared).toBe(false);
    expect(context.printState.writer).toBeUndefined();
  });

  test('evals direct object-valued attribute selector children', async () => {
    const node = rules([
      vardecl({
        name: 'attr-data',
        value: any('foo')
      })
    ]);
    const evald = await node.eval(context);
    context.root = evald;
    context.rulesContext = evald;

    const attrNode = attr({
      name: 'data',
      op: '=',
      value: ref({ key: 'attr-data' }, { type: 'variable' })
    });
    const evaluated = await attrNode.eval(context);

    expect(evaluated.toTrimmedString()).toBe('[data=foo]');
  });

  test('keeps source attribute selector values canonical after resolve(context)', async () => {
    const node = rules([
      vardecl({
        name: 'attr-data',
        value: any('foo')
      })
    ]);
    const evald = await node.eval(context);
    context.root = evald;
    context.rulesContext = evald;

    const attrNode = attr({
      name: 'data',
      op: '=',
      value: ref({ key: 'attr-data' }, { type: 'variable' })
    });
    const sourceValue = attrNode.value.value;
    const resolved = await attrNode.resolve(context);

    expect(resolved.render(context)).toBe('[data=foo]');
    expect(sourceValue?.parent).toBe(attrNode);
    expect(attrNode.toTrimmedString()).toBe('[data=$attr-data]');
  });

  test('keeps interpolated attribute selector values isolated across repeated mixin calls', async () => {
    context = new Context({
      collapseNesting: true,
      leakyRules: true
    });

    const node = rules([
      mixin({
        name: any('.emit'),
        params: list([any('name', { role: 'property' })]),
        rules: rules([
          vardecl({
            name: 'attr-data',
            value: ref({ key: 'name' }, { type: 'variable' })
          }),
          ruleset({
            selector: attr({
              name: 'data',
              op: '=',
              value: any('@{attr-data}')
            }),
            rules: rules([
              decl({ name: 'color', value: any('red') })
            ])
          })
        ])
      }),
      ruleset({
        selector: el('.one'),
        rules: rules([
          call({
            name: ref({ key: '.emit' }, { type: 'mixin' }),
            args: list([any('foo')])
          })
        ])
      }),
      ruleset({
        selector: el('.two'),
        rules: rules([
          call({
            name: ref({ key: '.emit' }, { type: 'mixin' }),
            args: list([any('bar')])
          })
        ])
      })
    ]);
    context.root = node;

    const css = await renderNodeToString(node, context, { collapseNesting: true });

    expect(css).toContain('.one [data="foo"]');
    expect(css).toContain('.two [data="bar"]');
    expect(css).not.toContain('.one [data="bar"]');
    expect(css).not.toContain('.two [data="foo"]');
  });
});
