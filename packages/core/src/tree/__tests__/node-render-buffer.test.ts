import { describe, expect, it } from 'vitest';
import type { IToken } from 'chevrotain';
import { Context } from '../../context.js';
import {
  amp,
  any,
  atrule,
  attr,
  bool,
  block,
  call,
  co,
  color,
  comment,
  compound,
  condition,
  coll,
  decl,
  defaultguard,
  dimension,
  el,
  expr,
  interpolated,
  interpolatedSelector,
  js,
  list,
  negative,
  nil,
  op,
  paren,
  pseudo,
  query,
  quoted,
  range,
  ref,
  rest,
  rawrules,
  rules,
  ruleset,
  seq,
  sel,
  sellist,
  url,
  vardecl
} from '../index.js';
import { jsexpr } from '../js-expr.js';
import { Node } from '../node-base.js';
import { OutputWriter } from '../util/print.js';
import { createRenderBuffer, renderNodeToBuffer, renderNodeToString } from '../util/render-buffer.js';

class AsyncResolvedNode extends Node<string> {
  override resolve() {
    return Promise.resolve(any('resolved'));
  }

  override toTrimmedString() {
    return 'source';
  }
}

class RejectingNode extends Node<string> {
  override resolve() {
    return Promise.reject(new Error('nope'));
  }
}

describe('renderNodeToBuffer', () => {
  it('writes resolved node output into flat buffers', () => {
    const context = new Context();
    const buffer = createRenderBuffer('flat');
    const node = any('red');

    const out = renderNodeToBuffer(node, context, buffer);

    expect(out).toBe('red');
    expect(buffer.parts).toEqual(['red']);
  });

  it('keeps node render as the string path', () => {
    const context = new Context();
    const node = any('blue');

    expect(node.render(context)).toBe('blue');
  });

  it('keeps async resolution on the explicit buffer path', async () => {
    const context = new Context();
    const buffer = createRenderBuffer('flat');
    const node = new AsyncResolvedNode('source');

    await expect(renderNodeToBuffer(node, context, buffer)).resolves.toBe('resolved');
    expect(buffer.parts).toEqual(['resolved']);
  });

  it('does not write rejected async output into flat buffers', async () => {
    const context = new Context();
    const buffer = createRenderBuffer('flat');
    const node = new RejectingNode('source');

    await expect(renderNodeToBuffer(node, context, buffer)).rejects.toThrow('nope');
    expect(buffer.parts).toEqual([]);
  });

  it('renders async resolved output to strings without eval pre-materialization', async () => {
    const context = new Context();
    const node = new AsyncResolvedNode('source');

    await expect(renderNodeToString(node, context)).resolves.toBe('resolved');
  });

  it('renders through the provided writer when string output is requested', () => {
    const context = new Context();
    const writer = new OutputWriter();
    const node = any('writer-output');

    expect(renderNodeToString(node, context, { writer })).toBe('writer-output');
    expect(writer.toString()).toBe('writer-output');
  });

  it('uses the canonical root serializer for root-only output', () => {
    const context = new Context();
    const root = rules([]);
    context.root = root;
    context.currentCharset = any('@charset "utf-8";', { role: 'charset' });
    context.topImports = [
      atrule({
        name: any('@import', { role: 'atkeyword' }),
        prelude: quoted(any('theme.css'))
      })
    ];

    expect(renderNodeToString(root, context, { context })).toBe('@charset "utf-8";\n@import "theme.css";\n');
  });

  it('uses the canonical root serializer when the source root resolves to an owned root surface', () => {
    const context = new Context();
    const root = rules([]);
    const resolvedRoot = rules([]);
    context.root = root;
    context.currentCharset = any('@charset "utf-8";', { role: 'charset' });
    root.resolve = () => resolvedRoot;

    expect(renderNodeToString(root, context, { context })).toBe('@charset "utf-8";\n');
  });

  it('reuses active print state instead of resetting it', () => {
    const context = new Context();
    const writer = new OutputWriter();
    const frameHeaders = ['@media screen'];
    const emittedTrivia = new Set<IToken[]>();
    const node = any('stateful-output');
    const options = {
      context,
      writer,
      frameHeaders,
      emittedTrivia
    };

    expect(renderNodeToString(node, context, options)).toBe('stateful-output');

    expect(options.writer).toBe(writer);
    expect(options.frameHeaders).toBe(frameHeaders);
    expect(options.emittedTrivia).toBe(emittedTrivia);
  });

  it('writes finalized string output into segmented buffers', () => {
    const context = new Context();
    const buffer = createRenderBuffer('segmented');
    const node = any('green');

    expect(renderNodeToBuffer(node, context, buffer)).toBe('green');
    expect(buffer.segments).toEqual(['green']);
  });

  it('keeps direct render and flat-buffer render aligned across node surfaces', async () => {
    const context = new Context();
    const root = rules([
      vardecl({ name: any('asset'), value: quoted('image.png') }),
      vardecl({ name: any('brand'), value: any('red') })
    ]);
    const evaldRoot = await root.eval(context);
    context.root = evaldRoot;
    context.rulesContext = evaldRoot;

    const cases: Array<{
      surface: string;
      node: Node;
      expected?: string;
      expectedParts?: string[];
      setup?: (ctx: Context) => void;
    }> = [
      { surface: 'Any', node: any('red'), expected: 'red' },
      { surface: 'Bool', node: bool(true), expected: 'true' },
      { surface: 'Dimension', node: dimension([10, 'px']), expected: '10px' },
      { surface: 'Color', node: color('#ff0000'), expected: '#ff0000' },
      { surface: 'Quoted', node: quoted('theme.css'), expected: '"theme.css"' },
      { surface: 'Url', node: url(quoted(ref({ key: 'asset' }, { type: 'variable' }))), expected: 'url("image.png")' },
      { surface: 'Comment', node: comment('/* note */'), expected: '/* note */' },
      { surface: 'Nil', node: nil(), expected: '', expectedParts: [] },
      { surface: 'Combinator', node: co('>'), expected: '>' },
      { surface: 'Rest', node: rest(any('items')), expected: '...$items' },
      {
        surface: 'DefaultGuard',
        node: defaultguard(),
        expected: 'true',
        setup: (ctx) => {
          ctx.isDefault = true;
        }
      },
      { surface: 'List', node: list([any('one'), any('two')]), expected: 'one, two' },
      { surface: 'Sequence', node: seq([any('1px'), any('solid'), any('red')]), expected: '1px solid red' },
      { surface: 'Paren', node: paren(any('screen')), expected: '(screen)' },
      { surface: 'Negative', node: negative(dimension([2, 'px'])), expected: '-2px' },
      { surface: 'Operation', node: op([dimension([10, 'px']), '+', dimension([5, 'px'])]), expected: '15px' },
      { surface: 'Call', node: call({ name: 'rgb', args: list([dimension([1]), dimension([2]), dimension([3])]) }), expected: 'rgb(1, 2, 3)' },
      { surface: 'Reference', node: ref({ key: 'brand' }, { type: 'variable' }), expected: 'red' },
      { surface: 'Declaration', node: decl({ name: 'color', value: any('red') }), expected: 'color: red' },
      {
        surface: 'AtRule',
        node: atrule({
          name: any('@media', { role: 'atkeyword' }),
          prelude: any('screen'),
          rules: rules([decl({ name: 'color', value: any('red') })])
        }),
        expected: '@media screen {\n  color: red;\n}\n'
      }
    ];

    expect(cases).toHaveLength(20);

    for (const item of cases) {
      item.setup?.(context);
      const direct = await Promise.resolve(item.node.render(context));
      const buffer = createRenderBuffer('flat');
      const buffered = await Promise.resolve(item.node.render(context, buffer));

      expect(buffered, item.surface).toBe(direct);
      expect(buffer.parts, item.surface).toEqual(item.expectedParts ?? [direct]);
      if (item.expected !== undefined) {
        expect(buffered, item.surface).toBe(item.expected);
      }
    }
  });

  it('keeps string and flat-buffer render aligned across additional node surfaces', async () => {
    const cases: Array<{
      surface: string;
      node: Node;
      expected?: string;
      expectedParts?: string[];
      setup?: (ctx: Context) => void;
    }> = [
      { surface: 'Rules', node: rules([decl({ name: 'color', value: any('red') })]) },
      {
        surface: 'Ruleset',
        node: ruleset({
          selector: el('.box'),
          rules: rules([decl({ name: 'color', value: any('red') })])
        })
      },
      { surface: 'BasicSelector', node: el('.box'), expected: '.box' },
      { surface: 'CompoundSelector', node: compound([el('.box'), el('.active')]), expected: '.box.active' },
      { surface: 'ComplexSelector', node: sel([el('.box'), co('>'), el('.child')]), expected: '.box > .child' },
      { surface: 'SelectorList', node: sellist([el('.a'), el('.b')]), expected: '.a,\n.b' },
      { surface: 'PseudoSelector', node: pseudo({ name: ':hover' }), expected: ':hover' },
      { surface: 'AttributeSelector', node: attr({ name: 'data-x', op: '=', value: quoted('yes') }), expected: '[data-x="yes"]' },
      {
        surface: 'Interpolated',
        node: interpolated({ source: 'icon-%%', replacements: [ref({ key: 'brand' }, { type: 'variable' })] }),
        expected: 'icon-red'
      },
      {
        surface: 'InterpolatedSelector',
        node: interpolatedSelector(
          interpolated({ source: '.%%', replacements: [ref({ key: 'class-name' }, { type: 'variable' })] })
        ),
        expected: '.active'
      },
      { surface: 'Expression', node: expr(op([dimension([2]), '+', dimension([3])])), expected: '5' },
      { surface: 'Range', node: range({ start: dimension([1]), end: dimension([3]), step: dimension([1]) }) },
      { surface: 'Condition', node: condition([dimension([2]), '>', dimension([1])]), expected: 'true' },
      { surface: 'QueryCondition', node: query([any('(min-width:'), dimension([10, 'px']), any(')')]) },
      { surface: 'Block', node: block(seq([any('red'), any('blue')]), { type: 'square' }) },
      { surface: 'Collection', node: coll([decl({ name: 'color', value: any('red') })]) },
      { surface: 'RawRules', node: rawrules([decl({ name: 'color', value: any('red') })]) },
      { surface: 'JsExpression', node: jsexpr('"ok"'), expected: 'ok' },
      { surface: 'JsImport', node: js({ path: quoted('tools.js') }, { namespace: 'tools' }), expected: '@-use "tools.js" as tools;' },
      { surface: 'Ampersand', node: amp({ appendValue: '-item' }), expected: '', expectedParts: [] }
    ];

    expect(cases).toHaveLength(20);

    for (const item of cases) {
      const context = new Context();
      const root = rules([
        vardecl({ name: any('brand'), value: any('red') }),
        vardecl({ name: any('class-name'), value: any('active') })
      ]);
      const evaldRoot = await root.eval(context);
      context.root = evaldRoot;
      context.rulesContext = evaldRoot;
      item.setup?.(context);

      const direct = await Promise.resolve(renderNodeToString(item.node, context, { context }));
      const buffer = createRenderBuffer('flat');
      const buffered = await Promise.resolve(renderNodeToBuffer(item.node, context, buffer, { context }));

      expect(buffered, item.surface).toBe(direct);
      expect(buffer.parts, item.surface).toEqual(item.expectedParts ?? [direct]);
      if (item.expected !== undefined) {
        expect(buffered, item.surface).toBe(item.expected);
      }
    }
  });
});
