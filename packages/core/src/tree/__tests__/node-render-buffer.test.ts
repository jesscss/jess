import { describe, expect, it } from 'vitest';
import type { IToken } from 'chevrotain';
import { Context } from '../../context.js';
import {
  Anonymous,
  MixinCollection,
  Selector,
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
  callableRulesEntry,
  customdecl,
  decl,
  defaultguard,
  dimension,
  el,
  extend,
  expr,
  fn,
  forNode,
  ifNode,
  interpolated,
  interpolatedSelector,
  js,
  jsarray,
  jsfunc,
  jsobj,
  keyword,
  list,
  log,
  mixin,
  negative,
  nil,
  num,
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
  selcap,
  sel,
  sellist,
  spaced,
  url,
  vardecl,
  whileNode
} from '../index.js';
import { extendList } from '../extend-list.js';
import { jsexpr } from '../js-expr.js';
import { F_MAY_ASYNC, F_NON_STATIC, Node } from '../node-base.js';
import { OutputWriter, getPrintOptions } from '../util/print.js';
import {
  createRenderBuffer,
  renderChosenOutput,
  renderNodeToBuffer,
  renderNodeToString,
  renderNodeToWriter,
  renderSelectedOutput,
  writeNoOutput,
  writeSelectedOutput,
  writeRootAwareSelectedOutput,
  writeRootAwareOutput
} from '../util/render-buffer.js';

const asyncResolvedBridgeNode = {
  resolve() {
    return Promise.resolve(any('resolved'));
  }
};

const rejectingBridgeNode = {
  resolve() {
    return Promise.reject(new Error('nope'));
  }
};

class SourceOnlyNode extends Node<string> {
  override resolve() {
    throw new Error('base render should not resolve source-only nodes');
  }

  override toTrimmedString(options?: Parameters<Node['toTrimmedString']>[0]) {
    getPrintOptions(options).writer.add('source');
    return 'source';
  }
}

class AsyncValueNode extends Node<string> {
  constructor(
    value: string,
    private readonly resolved: Node = any(value)
  ) {
    super(value);
    this.addFlags(F_NON_STATIC, F_MAY_ASYNC);
  }

  override eval() {
    return Promise.resolve(this.resolved);
  }

  override resolve() {
    return Promise.resolve(this.resolved);
  }

  override toTrimmedString(options?: Parameters<Node['toTrimmedString']>[0]) {
    const source = `source-${this.value}`;
    getPrintOptions(options).writer.add(source);
    return source;
  }
}

class RenderBufferSelector extends Selector<string> {
  override valueOf() {
    return this.value;
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

  it('keeps async resolution on the explicit non-native bridge path', async () => {
    const context = new Context();
    const buffer = createRenderBuffer('flat');

    await expect(renderNodeToBuffer(asyncResolvedBridgeNode, context, buffer)).resolves.toBe('resolved');
    expect(buffer.parts).toEqual(['resolved']);
  });

  it('does not write rejected async non-native bridge output into flat buffers', async () => {
    const context = new Context();
    const buffer = createRenderBuffer('flat');

    await expect(renderNodeToBuffer(rejectingBridgeNode, context, buffer)).rejects.toThrow('nope');
    expect(buffer.parts).toEqual([]);
  });

  it('renders async non-native bridge output to strings without eval pre-materialization', async () => {
    const context = new Context();

    await expect(renderNodeToString(asyncResolvedBridgeNode, context)).resolves.toBe('resolved');
  });

  it('uses inherited base render as direct source serialization', () => {
    const context = new Context();
    const buffer = createRenderBuffer('flat');
    const node = new SourceOnlyNode('source');

    expect(node.render(context)).toBe('source');
    expect(renderNodeToBuffer(node, context, buffer)).toBe('source');
    expect(buffer.parts).toEqual(['source']);
  });

  it('renders native buffer output to strings without reusing a provided writer', () => {
    const context = new Context();
    const writer = new OutputWriter();
    const node = any('writer-output');
    node.resolve = () => {
      throw new Error('renderNodeToString should use native buffer render');
    };

    expect(renderNodeToString(node, context, { writer })).toBe('writer-output');
    expect(writer.toString()).toBe('');
  });

  it('renders maybe-async selected output to strings without buffer writes', async () => {
    const context = new Context();
    const writer = new OutputWriter();

    expect(renderSelectedOutput(any('direct'), context, { writer })).toBe('direct');
    await expect(renderSelectedOutput(Promise.resolve(any('async')), context, { writer }))
      .resolves.toBe('async');
    expect(writer.toString()).toBe('directasync');
  });

  it('uses instance-owned native buffer render methods before resolving', () => {
    const context = new Context();
    const buffer = createRenderBuffer('flat');
    const node = {
      resolve() {
        throw new Error('renderNodeToBuffer should use native instance render');
      },
      render(_context: Context, target: typeof buffer) {
        target.parts.push('instance-output');
        return 'instance-output';
      }
    };

    expect(renderNodeToBuffer(node, context, buffer)).toBe('instance-output');
    expect(buffer.parts).toEqual(['instance-output']);
  });

  it('renders child nodes into an active writer without using the string helper name', () => {
    const context = new Context();
    const writer = new OutputWriter();
    const node = any('child-output');

    expect(renderNodeToWriter(node, context, { writer })).toBe('child-output');
    expect(writer.toString()).toBe('child-output');
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

  it('keeps the root serializer exception inside the root-aware buffer helper', () => {
    const context = new Context();
    const root = rules([]);
    const buffer = createRenderBuffer('flat');
    context.root = root;
    context.currentCharset = any('@charset "utf-8";', { role: 'charset' });

    const text = writeRootAwareOutput(buffer, root, root, context, { context });

    expect(text).toBe('@charset "utf-8";\n');
    expect(buffer.parts).toEqual(['@charset "utf-8";\n']);
  });

  it('keeps non-root rules output trimmed in the root-aware buffer helper', () => {
    const context = new Context();
    const root = rules([]);
    const childRules = rules([decl({ name: 'color', value: any('red') })]);
    const buffer = createRenderBuffer('flat');
    context.root = root;
    context.currentCharset = any('@charset "utf-8";', { role: 'charset' });

    const text = writeRootAwareOutput(buffer, childRules, childRules, context, { context });

    expect(text).toBe('color: red;');
    expect(buffer.parts).toEqual(['color: red;']);
  });

  it('writes selected evaluated output without mutating rejected buffers', async () => {
    const context = new Context();
    const syncBuffer = createRenderBuffer('flat');
    const asyncBuffer = createRenderBuffer('flat');
    const rejectedBuffer = createRenderBuffer('flat');

    expect(writeSelectedOutput(syncBuffer, any('sync'), context)).toBe('sync');
    await expect(writeSelectedOutput(asyncBuffer, Promise.resolve(any('async')), context)).resolves.toBe('async');
    await expect(writeSelectedOutput(rejectedBuffer, Promise.reject(new Error('nope')), context)).rejects.toThrow('nope');

    expect(syncBuffer.parts).toEqual(['sync']);
    expect(asyncBuffer.parts).toEqual(['async']);
    expect(rejectedBuffer.parts).toEqual([]);
  });

  it('routes chosen output through string and buffer render surfaces', async () => {
    const context = new Context();
    const buffer = createRenderBuffer('flat');
    const writer = new OutputWriter();

    expect(renderChosenOutput(context, any('direct'), { writer })).toBe('direct');
    await expect(renderChosenOutput(context, Promise.resolve(any('buffered')), buffer))
      .resolves.toBe('buffered');

    expect(writer.toString()).toBe('direct');
    expect(buffer.parts).toEqual(['buffered']);
  });

  it('writes invisible effect output without mutating rejected buffers', async () => {
    const syncBuffer = createRenderBuffer('flat');
    const asyncBuffer = createRenderBuffer('flat');
    const rejectedBuffer = createRenderBuffer('flat');

    expect(writeNoOutput(syncBuffer, undefined)).toBe('');
    await expect(writeNoOutput(asyncBuffer, Promise.resolve(any('ignored')))).resolves.toBe('');
    await expect(writeNoOutput(rejectedBuffer, Promise.reject(new Error('nope')))).rejects.toThrow('nope');

    expect(syncBuffer.parts).toEqual([]);
    expect(asyncBuffer.parts).toEqual([]);
    expect(rejectedBuffer.parts).toEqual([]);
  });

  it('writes root-aware selected output through the root serializer exception', async () => {
    const context = new Context();
    const root = rules([]);
    const syncBuffer = createRenderBuffer('flat');
    const asyncBuffer = createRenderBuffer('flat');
    context.root = root;
    context.currentCharset = any('@charset "utf-8";', { role: 'charset' });

    expect(writeRootAwareSelectedOutput(syncBuffer, root, root, context, { context })).toBe('@charset "utf-8";\n');
    await expect(writeRootAwareSelectedOutput(
      asyncBuffer,
      root,
      Promise.resolve(root),
      context,
      { context }
    )).resolves.toBe('@charset "utf-8";\n');

    expect(syncBuffer.parts).toEqual(['@charset "utf-8";\n']);
    expect(asyncBuffer.parts).toEqual(['@charset "utf-8";\n']);
  });

  it('uses native root render without consulting public resolve', () => {
    const context = new Context();
    const root = rules([]);
    context.root = root;
    context.currentCharset = any('@charset "utf-8";', { role: 'charset' });
    root.resolve = () => {
      throw new Error('renderNodeToString should use native root render');
    };

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

  it('awaits async direct render values on expression-like node surfaces', async () => {
    const context = new Context();
    const cases: Array<{
      surface: string;
      node: Node;
      expected: string;
    }> = [
      { surface: 'Expression', node: expr(new AsyncValueNode('value')), expected: 'value' },
      { surface: 'Sequence', node: seq([any('one'), new AsyncValueNode('two')]), expected: 'one two' },
      { surface: 'List', node: list([any('one'), new AsyncValueNode('two')]), expected: 'one, two' },
      { surface: 'Paren', node: paren(new AsyncValueNode('value')), expected: '(value)' },
      { surface: 'Condition', node: condition([new AsyncValueNode('truthy', bool(true))]), expected: 'true' },
      { surface: 'Quoted', node: quoted(new AsyncValueNode('asset')), expected: '"asset"' },
      { surface: 'Url', node: url(new AsyncValueNode('asset')), expected: 'url(asset)' }
    ];

    for (const item of cases) {
      await expect(Promise.resolve(item.node.render(context)), item.surface)
        .resolves.toBe(item.expected);
    }
  });

  it('keeps string and flat-buffer render aligned across the next node surfaces', async () => {
    const cases: Array<{
      surface: string;
      node: Node;
      expected?: string;
      expectedParts?: string[];
    }> = [
      { surface: 'Anonymous', node: new Anonymous('legacy-anon'), expected: 'legacy-anon' },
      { surface: 'Keyword', node: keyword('auto'), expected: 'auto' },
      { surface: 'Num', node: num(7), expected: '7' },
      { surface: 'CustomDeclaration', node: customdecl({ name: any('--gap'), value: any('0') }) },
      { surface: 'SpacedSequenceHelper', node: spaced([any('span'), any('2')]), expected: 'span 2' },
      { surface: 'Extend', node: extend({ target: el('.target') }), expected: '', expectedParts: [] },
      { surface: 'ExtendList', node: extendList([extend({ target: el('.target') })]), expectedParts: [] },
      { surface: 'SelectorCapture', node: selcap(el('.captured')), expected: '.captured' },
      { surface: 'Log', node: log({ level: 'debug', message: any('') }), expected: '', expectedParts: [] },
      { surface: 'JsArray', node: jsarray([any('one'), any('two')]) },
      { surface: 'JsObject', node: jsobj({ one: any('one') }) },
      { surface: 'JsFunction', node: jsfunc({ name: 'make-red', fn: () => 'red' }) },
      { surface: 'Mixin', node: mixin({ name: any('.paint'), rules: rules([decl({ name: 'color', value: any('red') })]) }) },
      { surface: 'Func', node: fn({ name: any('paint'), body: rules([decl({ name: 'return', value: any('red') })]) }) },
      {
        surface: 'If',
        node: ifNode({
          branches: [
            { condition: bool(true), rules: rules([decl({ name: 'color', value: any('red') })]) },
            { rules: rules([decl({ name: 'color', value: any('blue') })]) }
          ]
        })
      },
      {
        surface: 'ForRange',
        node: forNode({
          pattern: { kind: 'single', value: vardecl({ name: 'item', value: nil() }, { paramVar: true }) },
          iterable: {
            kind: 'range',
            start: dimension([1]),
            end: dimension([1]),
            includeStart: true,
            includeEnd: true
          },
          rules: rules([decl({ name: 'width', value: ref({ key: 'item' }, { type: 'variable' }) })])
        })
      },
      {
        surface: 'ForList',
        node: forNode({
          pattern: { kind: 'single', value: vardecl({ name: 'tone', value: nil() }, { paramVar: true }) },
          iterable: { kind: 'node', value: list([any('red'), any('blue')]) },
          rules: rules([decl({ name: 'color', value: ref({ key: 'tone' }, { type: 'variable' }) })])
        }),
        expectedParts: ['color: red;\n', 'color: blue;\n']
      },
      {
        surface: 'While',
        node: whileNode({
          condition: bool(false),
          rules: rules([decl({ name: 'color', value: any('red') })])
        }),
        expectedParts: []
      },
      {
        surface: 'MixinCollection',
        node: new MixinCollection([
          callableRulesEntry(
            { rules: rules([decl({ name: 'color', value: any('red') })]) },
            undefined,
            0
          )
        ])
      },
      { surface: 'SelectorBase', node: new RenderBufferSelector('.base'), expected: '.base' }
    ];

    expect(cases).toHaveLength(20);

    for (const item of cases) {
      const context = new Context();
      const root = rules([]);
      const evaldRoot = await root.eval(context);
      context.root = evaldRoot;
      context.rulesContext = evaldRoot;

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

  it('renders log nodes directly without public resolve', async () => {
    const context = new Context();
    const node = log({ level: 'debug', message: any('') });
    node.resolve = () => {
      throw new Error('Log direct render should evaluate diagnostics natively');
    };

    await expect(Promise.resolve(node.render(context))).resolves.toBe('');
    expect(node.evaluated).toBe(false);
    expect(node.registrationPrepared).toBe(false);
  });

  it('renders control nodes directly without public resolve', async () => {
    const context = new Context();
    const root = await rules([]).eval(context);
    context.root = root;
    context.rulesContext = root;

    const cases = [
      {
        surface: 'If',
        node: ifNode({
          branches: [
            { condition: bool(true), rules: rules([decl({ name: 'color', value: any('red') })]) },
            { rules: rules([decl({ name: 'color', value: any('blue') })]) }
          ]
        }),
        expected: 'color: red;'
      },
      {
        surface: 'For',
        node: forNode({
          pattern: { kind: 'single', value: vardecl({ name: 'item', value: nil() }, { paramVar: true }) },
          iterable: {
            kind: 'range',
            start: dimension([1]),
            end: dimension([1]),
            includeStart: true,
            includeEnd: true
          },
          rules: rules([decl({ name: 'width', value: ref({ key: 'item' }, { type: 'variable' }) })])
        })
      },
      {
        surface: 'While',
        node: whileNode({
          condition: bool(false),
          rules: rules([decl({ name: 'color', value: any('red') })])
        }),
        expected: ''
      }
    ];

    for (const item of cases) {
      item.node.resolve = () => {
        throw new Error(`${item.surface} direct render should use native control evaluation`);
      };

      const rendered = await Promise.resolve(item.node.render(context));
      expect(typeof rendered, item.surface).toBe('string');
      if ('expected' in item) {
        expect(rendered, item.surface).toBe(item.expected);
      }
      expect(item.node.evaluated, item.surface).toBe(false);
      expect(item.node.registrationPrepared, item.surface).toBe(false);
    }
  });
});
