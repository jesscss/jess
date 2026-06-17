import {
  ruleset,
  sel,
  el,
  sellist,
  rules,
  comment,
  decl,
  vardecl,
  spaced,
  any,
  call,
  dimension,
  ref,
  mixin,
  Node,
  type Rules,
  AssignmentType,
  VarDeclaration,
  style,
  quoted,
  type Declaration,
  type Selector,
  atrule
} from '../index.js';
import { Context, TreeContext } from '../../context.js';
import type { DeclarationFindOptions } from '../util/lookup-utils.js';
import { isNode } from '../util/is-node.js';
import { N } from '../node-type.js';
import { getPrintOptions, OutputWriter } from '../util/print.js';
import { createRenderBuffer, renderNodeToString } from '../util/render-buffer.js';
import { setScopeFrameLiveBinding } from '../scope-frame.js';

let context: Context;

function expectRulesNode(node: Node | undefined): Rules {
  if (!isNode(node, N.Rules)) {
    throw new Error(`Expected Rules, got ${node?.type ?? 'undefined'}`);
  }
  return node;
}

function expectDeclarationNode(node: Node | undefined): Declaration {
  if (!isNode(node, N.Declaration)) {
    throw new Error(`Expected Declaration, got ${node?.type ?? 'undefined'}`);
  }
  return node;
}

function getPropWithContext(context: Context, n: Rules, key: string, opts: DeclarationFindOptions = {}) {
  context.rulesContext = n;
  return n.findProperty(key, { ...opts, searchParents: true });
}

function getVarWithContext(context: Context, n: Rules, key: string, opts: DeclarationFindOptions = {}) {
  context.rulesContext = n;
  let decl = n.findVariable(key, { ...opts, searchParents: true });
  return decl;
}

function getDeclEitherWithContext(context: Context, n: Rules, key: string, opts: DeclarationFindOptions = {}) {
  context.rulesContext = n;
  return n.findAnyDeclaration(key, { ...opts, searchParents: true });
}

class WholeBufferCountingWriter extends OutputWriter {
  wholeBufferReads = 0;
  readbacks = 0;
  captures = 0;

  override getSince(mark: number): string {
    this.readbacks++;
    if (mark === 0) {
      this.wholeBufferReads++;
    }
    return super.getSince(mark);
  }

  override capture(fn: () => void): string {
    this.captures++;
    return super.capture(fn);
  }
}

describe('Rules', () => {
  beforeAll(() => {
    Node.prototype.fullRender = true;
  });

  afterAll(() => {
    Node.prototype.fullRender = false;
  });

  let getProp = getPropWithContext.bind(context, context);
  let getVar = getVarWithContext.bind(context, context);
  let getDeclEither = getDeclEitherWithContext.bind(context, context);
  // let getSelector = getSelectorWithContext.bind(context, context);
  beforeEach(() => {
    context = new Context();
    getProp = getPropWithContext.bind(context, context);
    getVar = getVarWithContext.bind(context, context);
    getDeclEither = getDeclEitherWithContext.bind(context, context);
    // getSelector = getSelectorWithContext.bind(context, context);
    context.id = 'testing';
  });

  it('exposes constructor-owned rules as the direct child field', () => {
    const child = decl({ name: 'color', value: any('red') });
    const node = rules([child]);

    expect(node.rules).toBe(node.value);
    expect(node.rules[0]).toBe(child);
    expect(node.constructor.childKeys).toEqual(['rules']);
  });

  it.skip('assigns position linearly for nested rules', async () => {
    let node = rules([
      vardecl({ name: 'one', value: any('one') }),
      vardecl({ name: 'root', value: any('value') }),
      rules([
        vardecl({ name: 'foo', value: any('bar') }),
        vardecl({ name: 'one', value: any('two') }),
        rules([
          vardecl({ name: 'one', value: any('three') })
        ])
      ])
    ]);
    node = await node.eval(context);
    let index = node.index;
    expect(index).toBe(0);
    expect(node.at(1)?.index).toBeGreaterThan(index);
    index = node.at(1)?.index ?? index;
    expect(node.at(2)?.index).toBeGreaterThan(index);
    index = node.at(2)?.index ?? index;
    const childRules = expectRulesNode(node.at(2));
    expect(childRules.at(0)?.index).toBeGreaterThan(index);
    index = childRules.at(1)?.index ?? index;
    expect(childRules.at(2)?.index).toBeGreaterThan(index);
    expect(expectRulesNode(childRules.at(2)).at(0)?.index).toBeGreaterThan(index);
  });

  it('keeps Rules render flags render-local', () => {
    const node = rules([
      decl({ name: 'color', value: any('red') })
    ], {
      referenceMode: true
    });
    const options = getPrintOptions({
      writer: new OutputWriter(),
      context,
      referenceMode: false,
      referenceRenderEnabled: true
    });

    const out = node.toTrimmedString(options);

    expect(out).toBe('color: red;');
    expect(options.referenceMode).toBe(false);
    expect(options.referenceRenderEnabled).toBe(true);
  });

  it('writes braced rules without return-value readback', () => {
    const writer = new WholeBufferCountingWriter();
    const node = rules([]);

    node.writeBraced(getPrintOptions({ writer }));

    expect(writer.toString()).toBe('{\n\n}');
    expect(writer.readbacks).toBe(0);
  });

  it('lets Rules.evalNode own registration prep', async () => {
    const node = rules([
      vardecl({ name: 'brand', value: any('red') }),
      decl({ name: 'color', value: ref({ key: 'brand' }, { type: 'variable' }) })
    ]);

    const evaluated = await node.eval(context);

    expect(evaluated.toTrimmedString()).toBe('color: red;');
    expect(node.registrationPrepared).toBe(true);
    expect(node.evaluated).toBe(true);
  });

  it('renders already evaluated rules without deriving another root surface', async () => {
    const source = rules([
      vardecl({ name: 'brand', value: any('red') }),
      decl({ name: 'color', value: ref({ key: 'brand' }, { type: 'variable' }) })
    ]);
    const evaluated = await source.eval(context);
    context.root = evaluated;
    context.rulesContext = evaluated;

    const originalDerive = evaluated.derive;
    let deriveCalls = 0;
    evaluated.derive = function countDeriveCalls(
      this: typeof evaluated,
      ...args: Parameters<typeof originalDerive>
    ): ReturnType<typeof originalDerive> {
      deriveCalls++;
      return originalDerive.apply(this, args);
    };

    expect(evaluated.render(context)).toBe('color: red;\n');
    expect(deriveCalls).toBe(0);
  });

  it('renders registration-prepared rules without deriving another root surface', async () => {
    const source = rules([
      vardecl({ name: 'brand', value: any('red') }),
      decl({ name: 'color', value: ref({ key: 'brand' }, { type: 'variable' }) })
    ]);
    const prepared = await source.prepareRegistration(context);
    context.root = prepared;
    context.rulesContext = prepared;

    const originalDerive = prepared.derive;
    let deriveCalls = 0;
    prepared.derive = function countDeriveCalls(
      this: typeof prepared,
      ...args: Parameters<typeof originalDerive>
    ): ReturnType<typeof originalDerive> {
      deriveCalls++;
      return originalDerive.apply(this, args);
    };

    expect(await Promise.resolve(prepared.render(context))).toBe('color: red;\n');
    expect(deriveCalls).toBe(0);
  });

  it('resolves static rules without deriving another root surface', () => {
    const node = rules([
      decl({ name: 'color', value: any('red') })
    ]);
    const originalDerive = node.derive;
    let deriveCalls = 0;
    node.derive = function countDeriveCalls(
      this: typeof node,
      ...args: Parameters<typeof originalDerive>
    ): ReturnType<typeof originalDerive> {
      deriveCalls++;
      return originalDerive.apply(this, args);
    };

    expect(node.resolve(context)).toBe(node);
    expect(deriveCalls).toBe(0);
    expect(node.evaluated).toBe(false);
  });

  it('resolves registration-prepared rules without deriving another root surface', async () => {
    const source = rules([
      vardecl({ name: 'brand', value: any('red') }),
      decl({ name: 'color', value: ref({ key: 'brand' }, { type: 'variable' }) })
    ]);
    const prepared = await source.prepareRegistration(context);
    const originalDerive = prepared.derive;
    let deriveCalls = 0;
    prepared.derive = function countDeriveCalls(
      this: typeof prepared,
      ...args: Parameters<typeof originalDerive>
    ): ReturnType<typeof originalDerive> {
      deriveCalls++;
      return originalDerive.apply(this, args);
    };

    const resolved = await prepared.resolve(context);

    expect(resolved.toTrimmedString()).toBe('color: red;');
    expect(deriveCalls).toBe(0);
  });

  it('drops empty derived scope frames while preserving fallback frames', () => {
    const source = rules([
      decl({ name: any('color'), value: any('red') })
    ]);
    const emptyFrame = source.getScopeFrame();
    expect(emptyFrame.rulesNode).toBe(source);

    const emptyDerived = source.derive([]);
    expect(emptyDerived._scopeFrame).toBeUndefined();

    const fallbackRules = rules([]);
    source.getScopeFrame().fallbackFrame = fallbackRules.getScopeFrame();

    const fallbackDerived = source.derive([]);
    expect(fallbackDerived.scopeFrame?.rulesNode).toBe(fallbackDerived);
    expect(fallbackDerived.scopeFrame?.fallbackFrame).toBe(fallbackRules.getScopeFrame());
  });

  it('handles charset output-order bookkeeping without child registration prep', async () => {
    const charset = any('@charset "utf-8";', { role: 'charset' });
    charset.prepareRegistration = () => {
      throw new Error('charset output-order handling should be owned by Rules');
    };
    const node = rules([
      charset,
      decl({ name: 'color', value: any('red') })
    ]);

    await node.eval(context);

    expect(context.currentCharset).toBe(charset);
    expect(node.value[0]?.type).toBe('Nil');
    expect(node.render(context)).toBe('@charset "utf-8";\ncolor: red;\n');
  });

  it('reuses context-owned render state without accumulating prior output', () => {
    const node = rules([
      decl({ name: 'color', value: any('red') })
    ]);

    const first = node.render(context);
    const second = node.render(context);

    expect(first).toBe('color: red;');
    expect(second).toBe('color: red;');
    expect(context.printState.writer?.toString()).toBe('color: red;');
  });

  it('writes rules body output into render buffers', async () => {
    const node = rules([
      decl({ name: 'color', value: any('red') })
    ]);
    const buffer = createRenderBuffer('flat');
    context.root = rules([]);
    const originalResolve = node.resolve;
    let resolveCalls = 0;
    node.resolve = function countResolveCalls(
      this: typeof node,
      ...args: Parameters<typeof originalResolve>
    ): ReturnType<typeof originalResolve> {
      resolveCalls++;
      return originalResolve.apply(this, args);
    };

    const rendered = await node.render(context, buffer);

    expect(rendered).toBe('color: red;\n');
    expect(buffer.parts).toEqual(['color: red;\n']);
    expect(resolveCalls).toBe(0);
    expect(node.evaluated).toBe(false);
    expect(node.registrationPrepared).toBe(false);
  });

  it('keeps non-root direct render as a body fragment while buffers keep emitted separators', async () => {
    const node = rules([
      decl({ name: 'color', value: any('red') })
    ]);
    const buffer = createRenderBuffer('flat');
    context.root = rules([]);

    expect(await Promise.resolve(node.render(context, buffer))).toBe('color: red;\n');
    expect(buffer.parts).toEqual(['color: red;\n']);
    await expect(Promise.resolve(node.render(context))).resolves.toBe('color: red;');
  });

  it('renders rules body output directly without public resolve', async () => {
    const node = rules([
      decl({ name: 'color', value: any('red') })
    ]);
    context.root = rules([]);
    node.resolve = () => {
      throw new Error('Rules direct body render should evaluate natively');
    };

    await expect(Promise.resolve(node.render(context))).resolves.toBe('color: red;');
    expect(node.evaluated).toBe(false);
    expect(node.registrationPrepared).toBe(false);
  });

  it('renders unprepared dynamic rules without deriving a wrapper tree', async () => {
    const sourceVar = vardecl({ name: 'brand', value: any('red') });
    const sourceDecl = decl({ name: 'color', value: ref({ key: 'brand' }, { type: 'variable' }) });
    const node = rules([sourceVar, sourceDecl]);
    context.root = rules([]);
    context.rulesContext = undefined;
    const originalDerive = node.derive;
    let deriveCalls = 0;
    node.derive = function countDeriveCalls(
      this: typeof node,
      ...args: Parameters<typeof originalDerive>
    ): ReturnType<typeof originalDerive> {
      deriveCalls++;
      return originalDerive.apply(this, args);
    };

    await expect(Promise.resolve(node.render(context))).resolves.toBe('color: red;');
    expect(deriveCalls).toBe(0);
    expect(node.evaluated).toBe(false);
    expect(node.registrationPrepared).toBe(false);
    expect(sourceVar.parent).toBe(node);
    expect(sourceDecl.parent).toBe(node);
    expect(context.rulesContext).toBeUndefined();
  });

  it('restores an empty root context after unprepared root render', async () => {
    const node = rules([
      vardecl({ name: 'brand', value: any('red') }),
      decl({ name: 'color', value: ref({ key: 'brand' }, { type: 'variable' }) })
    ]);

    await expect(Promise.resolve(node.render(context))).resolves.toBe('color: red;\n');
    expect(context.root).toBeUndefined();
    expect(context.rulesContext).toBeUndefined();
    expect(context.treeRoot).toBeUndefined();
  });

  it('awaits native render children while preserving the source rules surface', async () => {
    const child = decl({ name: 'color', value: any('red') });
    const node = rules([child]);
    context.root = rules([]);
    const originalRender = child.render;
    child.render = function countAsyncChildRender(
      this: typeof child,
      childContext: Context,
      bufferOrOptions?: Parameters<typeof originalRender>[1],
      options?: Parameters<typeof originalRender>[2]
    ): ReturnType<typeof originalRender> {
      return Promise.resolve().then(() => originalRender.call(this, childContext, bufferOrOptions, options));
    };

    await expect(Promise.resolve(node.render(context))).resolves.toBe('color: red;');
    expect(node.evaluated).toBe(false);
    expect(node.registrationPrepared).toBe(false);
    expect(child.evaluated).toBe(false);
  });

  it('writes root-owned charset and imports into render buffers', async () => {
    const root = rules([]);
    const buffer = createRenderBuffer('segmented');
    context.root = root;
    context.currentCharset = any('@charset "utf-8";', { role: 'charset' });
    context.topImports = [
      atrule({
        name: any('@import', { role: 'atkeyword' }),
        prelude: quoted(any('theme.css'))
      })
    ];
    const originalResolve = root.resolve;
    let resolveCalls = 0;
    root.resolve = function countResolveCalls(
      this: typeof root,
      ...args: Parameters<typeof originalResolve>
    ): ReturnType<typeof originalResolve> {
      resolveCalls++;
      return originalResolve.apply(this, args);
    };

    const rendered = await root.render(context, buffer);

    expect(rendered).toBe('@charset "utf-8";\n@import "theme.css";\n');
    expect(buffer.segments).toEqual([rendered]);
    expect(resolveCalls).toBe(0);
    expect(root.evaluated).toBe(false);
    expect(root.registrationPrepared).toBe(false);
  });

  it('renders root-owned charset and imports directly without public resolve', async () => {
    const root = rules([]);
    context.root = root;
    context.currentCharset = any('@charset "utf-8";', { role: 'charset' });
    context.topImports = [
      atrule({
        name: any('@import', { role: 'atkeyword' }),
        prelude: quoted(any('theme.css'))
      })
    ];
    root.resolve = () => {
      throw new Error('Root Rules direct render should keep root-aware output native');
    };

    await expect(Promise.resolve(root.render(context))).resolves.toBe('@charset "utf-8";\n@import "theme.css";\n');
    expect(root.evaluated).toBe(false);
    expect(root.registrationPrepared).toBe(false);
  });

  it('resolves unprepared rules without deriving a wrapper tree', async () => {
    const originalClone = Node.prototype.clone;
    let clonedRules = 0;
    Node.prototype.clone = function cloneForCounting(
      this: Node,
      ...args: Parameters<typeof originalClone>
    ): ReturnType<typeof originalClone> {
      if (this.type === 'Rules') {
        clonedRules++;
      }
      return originalClone.apply(this, args);
    };

    try {
      const root = rules([
        vardecl({ name: any('tone'), value: any('red') }),
        decl({ name: any('color'), value: ref({ key: 'tone' }, { type: 'variable' }) })
      ]);
      const originalDerive = root.derive;
      let deriveCalls = 0;
      root.derive = function countDeriveCalls(
        this: typeof root,
        ...args: Parameters<typeof originalDerive>
      ): ReturnType<typeof originalDerive> {
        deriveCalls++;
        return originalDerive.apply(this, args);
      };

      const resolved = await root.resolve(context);

      expect(resolved.toTrimmedString()).toContain('color: red;');
      expect(deriveCalls).toBe(0);
      expect(clonedRules).toBe(0);
      expect(root.evaluated).toBe(true);
    } finally {
      Node.prototype.clone = originalClone;
    }
  });

  it('does not count direct comment children as numeric rule entries', () => {
    const node = rules([
      comment('/**/'),
      decl({ name: 'color', value: any('red') }),
      comment('/* two */'),
      decl({ name: 'width', value: any('1px') })
    ]);

    expect(node.at(0)?.type).toBe('Declaration');
    expect(node.at(1)?.type).toBe('Declaration');
    expect(String(node.at(-1))).toBe('width: 1px');
  });

  it('keeps source serialization separate from context-owned render state', async () => {
    const scope = await rules([
      vardecl({ name: 'tone', value: any('red') })
    ]).eval(context);
    context.root = scope;
    context.rulesContext = scope;

    const node = ref({ key: 'tone' }, { type: 'variable' });

    expect(node.render(context)).toBe('red');
    expect(context.printState.writer?.toString()).toBe('red');
    expect(node.toTrimmedString()).toBe('$tone');
    expect(context.printState.writer?.toString()).toBe('red');
    expect(node.toString()).toBe('$tone');
  });

  it('keeps explicit toString writers detached from context print state', () => {
    const node = rules([
      decl({ name: 'color', value: any('red') })
    ]);
    const firstWriter = new OutputWriter();
    const secondWriter = new OutputWriter();

    const first = node.toString({ context, writer: firstWriter });
    const second = node.toString({ context, writer: secondWriter });

    expect(first).toBe('color: red;\n');
    expect(second).toBe('color: red;\n');
    expect(firstWriter.toString()).toBe('color: red;');
    expect(secondWriter.toString()).toBe('color: red;');
    expect(context.printState.writer).toBeUndefined();
  });

  it('does not inspect the whole output buffer for each emitted child boundary', () => {
    const writer = new WholeBufferCountingWriter();
    const declarations = Array.from({ length: 12 }, (_, index) => (
      decl({ name: `p${index}`, value: any(String(index)) })
    ));
    const node = rules(declarations);

    expect(node.toString({ writer })).toContain('p11: 11;');
    expect(writer.wholeBufferReads).toBeLessThanOrEqual(declarations.length + 4);
  });

  it('streams root charset and imports without capture scaffolding', () => {
    const writer = new WholeBufferCountingWriter();
    const charset = any('@charset "utf-8";', { role: 'charset' });
    const importRule = atrule({
      name: any('@import', { role: 'atkeyword' }),
      prelude: quoted(any('theme.css'))
    });
    charset.toTrimmedString = () => {
      throw new Error('Rules root serializer should write charset syntax directly');
    };
    importRule.toString = () => {
      throw new Error('Rules root serializer should write imports directly');
    };
    context.currentCharset = charset;
    context.topImports = [
      importRule
    ];
    const node = rules([]);

    expect(node.toString({ context, writer })).toBe('@charset "utf-8";\n@import "theme.css";\n');
    expect(writer.captures).toBe(0);
  });

  it('keeps sibling ruleset braces intact when declarations render values through active context output', async () => {
    const root = rules([
      ruleset({
        selector: any('.a'),
        rules: rules([
          decl({ name: 'width', value: dimension([10, 'px']) })
        ])
      }),
      ruleset({
        selector: any('.b'),
        rules: rules([
          decl({ name: 'width', value: dimension([20, 'px']) })
        ])
      }),
      ruleset({
        selector: any('.c'),
        rules: rules([
          decl({ name: 'width', value: dimension([30, 'px']) })
        ])
      })
    ]);

    const css = await renderNodeToString(root, context, { context });

    expect(css).toBeString(`
      .a {
        width: 10px;
      }
      .b {
        width: 20px;
      }
      .c {
        width: 30px;
      }
    `);
  });

  it('keeps separate sibling rulesets with the same selector in separate blocks', async () => {
    const root = rules([
      ruleset({
        selector: any('.same'),
        rules: rules([
          decl({ name: 'color', value: any('red') })
        ])
      }),
      ruleset({
        selector: any('.same'),
        rules: rules([
          decl({ name: 'background', value: any('blue') })
        ])
      })
    ]);

    const css = await renderNodeToString(root, context, { context });

    expect(css).toBeString(`
      .same {
        color: red;
      }
      .same {
        background: blue;
      }
    `);
  });

  describe('Scope / lookups', () => {
    describe('set / get vars & props', () => {
      it('can do a normal get / set of properties', async () => {
        let node = rules([
          decl({ name: 'foo', value: any('bar') })
        ]);
        node = await node.eval(context);

        expect(getProp(node, 'foo')?.toTrimmedString()).toBe('foo: bar');
      });

      it('can do a normal get / set of variables', async () => {
        let node = rules([
          vardecl({ name: 'foo', value: any('bar') })
        ]);
        node = await node.eval(context);
        expect(getVar(node, 'foo')?.toTrimmedString()).toBe('$foo: bar');
      });

      it('findAnyDeclaration picks VarDeclaration or Declaration by source order', async () => {
        let node = rules([
          vardecl({ name: any('n'), value: any('from-var') }),
          decl({ name: any('n'), value: any('from-decl') })
        ]);
        node = await node.eval(context);
        expect(isNode(getDeclEither(node, 'n'), N.Declaration)).toBe(true);
        expect(isNode(getDeclEither(node, 'n'), N.VarDeclaration)).toBe(false);

        let node2 = rules([
          decl({ name: any('m'), value: any('from-decl') }),
          vardecl({ name: any('m'), value: any('from-var') })
        ]);
        node2 = await node2.eval(context);
        expect(isNode(getDeclEither(node2, 'm'), N.VarDeclaration)).toBe(true);
      });

      it('replaces variable values', async () => {
        let node = rules([
          vardecl({ name: 'foo', value: any('one') }),
          vardecl({ name: 'foo', value: any('two') })
        ]);
        node = await node.eval(context);
        expect(getVar(node, 'foo')?.toTrimmedString()).toBe('$foo: two');
      });

      it.skip('will not set if defined', async () => {
        let decl1 = vardecl({ name: 'first', value: any('one') }, { assign: AssignmentType.CondAssign });
        let decl2 = vardecl({ name: 'first', value: any('two') }, { assign: AssignmentType.CondAssign });
        let node = rules([
          decl1,
          decl2
        ]);
        node = await node.eval(context);
        /** This won't have been resolved, so we need to evaluate it. */
        let result = await getVar(node, 'first')!.eval(context);
        expect(result.toTrimmedString()).toBe('$first: one');
      });

      // it('will skip normalization', () => {
      //   scope.setVar('one', 'one', { isNormalized: true, protected: true })
      //   expect(scope.getVar('one')).toEqual('one')
      // })

      it('throws if undefined', async () => {
        let node = rules([
          decl({ name: 'foo', value: ref({ key: 'first' }, { type: 'variable' }) })
        ]);
        expect(() => {
          const result = node.eval(context);
          if (result instanceof Promise) {
            // This shouldn't happen for this test case
            throw new Error('Expected synchronous evaluation');
          }
          return result;
        }).toThrow('\'first\' is not defined');
      });

      it('doesn\'t throw error if there\'s a fallback', async () => {
        let node = rules([
          decl({ name: 'foo', value: ref({ key: 'first' }, { type: 'variable', fallbackValue: true }) })
        ]);
        const result = node.eval(context);
        if (result instanceof Promise) {
          await expect(result).resolves.not.toThrow();
        } else {
          // Synchronous result, no error thrown
          expect(result).toBeDefined();
        }
      });

      it('does not retry style imports when content evaluation fails', async () => {
        let attempts = 0;
        let node = rules([
          style({ path: quoted(any('retry-target.jess')) }, { type: 'import' })
        ]);
        const target = node.at(0);
        if (!target) {
          throw new Error('Expected first rule to exist');
        }
        // Simulate a content evaluation error (not a path resolution error).
        // Only path resolution errors (tagged with _isPathResolutionError)
        // should be retried — content errors mean the tree was already cloned
        // and retrying would wastefully re-clone it.
        const failEval: typeof target.eval = () => {
          attempts += 1;
          throw new Error('content-eval-failure');
        };
        target.eval = failEval;

        await expect(async () => {
          await node.eval(context);
        }).rejects.toThrow('content-eval-failure');

        // Content evaluation errors are not retried — only path resolution errors are
        expect(attempts).toBe(1);
      });
    });

    describe('scope inheritance', () => {
      it('looks up parent scope', async () => {
        let inherited = rules([]);
        let node = rules([
          vardecl({ name: 'foo', value: any('bar') }),
          inherited
        ]);

        node = await node.eval(context);
        expect(getVar(inherited, 'foo')?.toTrimmedString()).toBe('$foo: bar');
      });

      it('inherits values when set after', async () => {
        let inherited = rules([]);
        let node = rules([
          inherited
        ]);
        node.push(vardecl({ name: 'foo', value: any('bar') }));

        node = await node.eval(context);
        expect(getVar(inherited, 'foo')?.toTrimmedString()).toBe('$foo: bar');
      });

      it('peeks into optional child scope', async () => {
        let node = rules([
          rules([
            vardecl({ name: 'one', value: any('two') })
          ], {
            rulesVisibility: {
              VarDeclaration: 'optional'
            }
          })
        ]);

        node = await node.eval(context);
        expect(getVar(node, 'one')?.toTrimmedString()).toBe('$one: two');
      });

      it('fails to get private child scope', async () => {
        let node = rules([
          rules([
            vardecl({ name: 'one', value: any('two') })
          ], {
            rulesVisibility: {
              VarDeclaration: 'private'
            }
          })
        ]);

        node = await node.eval(context);
        expect(getVar(node, 'one')).toBeUndefined();
      });

      it('skips an optional value', async () => {
        let node = rules([
          vardecl({ name: 'one', value: any('one') }),
          rules([
            vardecl({ name: 'one', value: any('two') })
          ], {
            rulesVisibility: {
              VarDeclaration: 'optional'
            }
          })
        ]);

        node = await node.eval(context);
        expect(getVar(node, 'one')?.toTrimmedString()).toBe('$one: one');
      });

      it('returns optional value when no public value found', async () => {
        let node = rules([
          rules([
            vardecl({ name: 'one', value: any('optional-value') })
          ], {
            rulesVisibility: {
              VarDeclaration: 'optional'
            }
          }),
          rules([
            vardecl({ name: 'two', value: any('public-value') })
          ])
        ]);

        node = await node.eval(context);
        // Should find optional value since no public value exists
        expect(getVar(node, 'one')?.toTrimmedString()).toBe('$one: optional-value');
        // Should find public value
        expect(getVar(node, 'two')?.toTrimmedString()).toBe('$two: public-value');
      });

      it('handles optional values with mixed positions and start parameter', async () => {
        let node = rules([
          vardecl({ name: 'var', value: any('first') }),
          vardecl({ name: 'var', value: any('second') }),
          rules([
            vardecl({ name: 'var', value: any('optional-early') })
          ], {
            rulesVisibility: {
              VarDeclaration: 'optional'
            }
          }),
          vardecl({ name: 'var', value: any('third') }),
          rules([
            vardecl({ name: 'var', value: any('optional-late') })
          ], {
            rulesVisibility: {
              VarDeclaration: 'optional'
            }
          })
        ]);

        node = await node.eval(context);
        // Should find the last public value (third), not optional values
        expect(getVar(node, 'var')?.toTrimmedString()).toBe('$var: third');

        // Test with start parameter - should find value before start position
        const thirdVar = node.value.find(n => isNode(n, N.VarDeclaration) && n.name.valueOf() === 'var' && n.valueNode.valueOf() === 'third');
        if (thirdVar && 'index' in thirdVar) {
          const result = getVar(node, 'var', { start: thirdVar.index });
          expect(result).toBeDefined();
          expect(result?.toTrimmedString()).toBe('$var: second');
        }
      });

      it('handles nested optional Rules with different indexing', async () => {
        let node = rules([
          rules([
            vardecl({ name: 'nested', value: any('nested-optional') }),
            rules([
              vardecl({ name: 'deep', value: any('deep-optional') })
            ], {
              rulesVisibility: {
                VarDeclaration: 'optional'
              }
            })
          ], {
            rulesVisibility: {
              VarDeclaration: 'optional'
            }
          }),
          vardecl({ name: 'nested', value: any('public-nested') }),
          vardecl({ name: 'deep', value: any('public-deep') })
        ]);

        node = await node.eval(context);
        // Should find public value, not optional nested value
        expect(getVar(node, 'nested')?.toTrimmedString()).toBe('$nested: public-nested');
        // Should find public value, not optional deep value
        expect(getVar(node, 'deep')?.toTrimmedString()).toBe('$deep: public-deep');
      });

      it('selects last optional value when multiple optionals found and no public', async () => {
        let node = rules([
          rules([
            vardecl({ name: 'var', value: any('optional-first') })
          ], {
            rulesVisibility: {
              VarDeclaration: 'optional'
            }
          }),
          rules([
            vardecl({ name: 'var', value: any('optional-second') })
          ], {
            rulesVisibility: {
              VarDeclaration: 'optional'
            }
          }),
          rules([
            vardecl({ name: 'var', value: any('optional-third') })
          ], {
            rulesVisibility: {
              VarDeclaration: 'optional'
            }
          })
        ]);

        node = await node.eval(context);
        // Should find the last optional value by source order (comparePosition)
        expect(getVar(node, 'var')?.toTrimmedString()).toBe('$var: optional-third');
      });

      it('handles optional values with start parameter in different Rules', async () => {
        let node = rules([
          vardecl({ name: 'var', value: any('root-first') }),
          rules([
            vardecl({ name: 'var', value: any('optional-in-child') })
          ], {
            rulesVisibility: {
              VarDeclaration: 'optional'
            }
          }),
          vardecl({ name: 'var', value: any('root-second') }),
          vardecl({ name: 'var', value: any('root-third') })
        ]);

        node = await node.eval(context);
        // Find the last public value
        expect(getVar(node, 'var')?.toTrimmedString()).toBe('$var: root-third');

        // Test with start parameter pointing to root-third
        const thirdVar = node.value.find(n => isNode(n, N.VarDeclaration) && n.name.valueOf() === 'var' && n.valueNode.valueOf() === 'root-third');
        if (thirdVar && 'index' in thirdVar) {
          const result = getVar(node, 'var', { start: thirdVar.index });
          expect(result).toBeDefined();
          // Should find root-second (before start), not optional value
          expect(result?.toTrimmedString()).toBe('$var: root-second');
        }
      });

      it('handles complex scenario: public, optional, then public again', async () => {
        let node = rules([
          vardecl({ name: 'var', value: any('public-1') }),
          rules([
            vardecl({ name: 'var', value: any('optional-1') }),
            vardecl({ name: 'var', value: any('optional-2') })
          ], {
            rulesVisibility: {
              VarDeclaration: 'optional'
            }
          }),
          vardecl({ name: 'var', value: any('public-2') })
        ]);

        node = await node.eval(context);
        // Should find the last public value, ignoring optional values
        expect(getVar(node, 'var')?.toTrimmedString()).toBe('$var: public-2');
      });

      it('handles optional values in Rules with different indices from parent', async () => {
        // Create a scenario where child Rules have different indexing
        let childRules = rules([
          vardecl({ name: 'var', value: any('child-optional') })
        ], {
          rulesVisibility: {
            VarDeclaration: 'optional'
          }
        });

        let node = rules([
          vardecl({ name: 'var', value: any('parent-1') }),
          childRules,
          vardecl({ name: 'var', value: any('parent-2') })
        ]);

        node = await node.eval(context);
        // Should find parent-2 (last public), not child-optional
        expect(getVar(node, 'var')?.toTrimmedString()).toBe('$var: parent-2');

        // Test lookup from within child Rules - should find its own value
        // Optional declarations are fallback-only and should not overtake public declarations
        // that are reachable in the lookup chain.
        const childVar = getVar(childRules, 'var');
        expect(childVar).toBeDefined();
        expect(childVar?.toTrimmedString()).toBe('$var: parent-2');
      });

      it('handles multiple optional Rules with declarations at different positions', async () => {
        let node = rules([
          rules([
            vardecl({ name: 'a', value: any('optional-a-1') }),
            vardecl({ name: 'b', value: any('optional-b-1') })
          ], {
            rulesVisibility: {
              VarDeclaration: 'optional'
            }
          }),
          vardecl({ name: 'a', value: any('public-a') }),
          rules([
            vardecl({ name: 'b', value: any('optional-b-2') }),
            vardecl({ name: 'c', value: any('optional-c') })
          ], {
            rulesVisibility: {
              VarDeclaration: 'optional'
            }
          }),
          vardecl({ name: 'b', value: any('public-b') })
        ]);

        node = await node.eval(context);
        // Should find public-a, ignoring optional-a-1
        expect(getVar(node, 'a')?.toTrimmedString()).toBe('$a: public-a');
        // Should find public-b, ignoring optional-b-1 and optional-b-2
        expect(getVar(node, 'b')?.toTrimmedString()).toBe('$b: public-b');
        // Should find optional-c since no public c exists
        expect(getVar(node, 'c')?.toTrimmedString()).toBe('$c: optional-c');
      });

      it('nested rulesets inherit nearer parent vars over globals in Less mode', async () => {
        context = new Context({ leakyRules: true });
        getProp = getPropWithContext.bind(context, context);
        getVar = getVarWithContext.bind(context, context);
        getDeclEither = getDeclEitherWithContext.bind(context, context);

        let root = rules([
          vardecl({ name: 'z', value: any('transparent') }),
          ruleset({
            selector: el('.scope1'),
            rules: rules([
              vardecl({ name: 'z', value: any('black') }),
              ruleset({
                selector: el('.scope2'),
                rules: rules([
                  ruleset({
                    selector: el('.scope3'),
                    rules: rules([
                      decl({ name: 'border-color', value: ref('z', { type: 'variable' }) })
                    ])
                  })
                ])
              })
            ])
          })
        ]);

        root = await root.eval(context);
        expect(context.searchScope.size).toBe(0);
        const scope1 = root.at(1);
        if (!isNode(scope1, N.Ruleset)) {
          throw new Error(`Expected Ruleset at index 1, got ${scope1?.type ?? 'undefined'}`);
        }
        const scope2 = scope1.rules.at(1);
        if (!isNode(scope2, N.Ruleset)) {
          throw new Error(`Expected Ruleset at nested index 1, got ${scope2?.type ?? 'undefined'}`);
        }
        const scope3 = scope2.rules.at(0);
        if (!isNode(scope3, N.Ruleset)) {
          throw new Error(`Expected Ruleset at nested index 0, got ${scope3?.type ?? 'undefined'}`);
        }
        const scope3Rules = scope3.rules;
        expect(getVar(scope3Rules, 'z', { start: 0 })?.toTrimmedString()).toBe('$z: black');
        const scope3Found = scope3Rules.findVariable('z', {
          filter: () => true,
          context,
          hasTarget: false,
          searchParents: true,
          start: 0
        });
        expect(scope3Found?.toTrimmedString()).toBe('$z: black');
        const border = expectDeclarationNode(scope3Rules.at(0));
        context.rulesContext = scope3Rules;
        const evald = await border.eval(context);
        expect(evald.toTrimmedString()).toBe('border-color: black');
      });

      it('preserves start when searching later child rules', async () => {
        context = new Context({ leakyRules: true });
        getProp = getPropWithContext.bind(context, context);
        getVar = getVarWithContext.bind(context, context);
        getDeclEither = getDeclEitherWithContext.bind(context, context);

        let root = rules([
          vardecl({ name: 'mix', value: any('blue') }),
          decl({ name: 'color', value: ref('mix', { type: 'variable' }) }),
          rules([
            vardecl({ name: 'mix', value: any('green') })
          ], {
            rulesVisibility: {
              VarDeclaration: 'public'
            }
          })
        ]);

        root = await root.eval(context);
        const color = expectDeclarationNode(root.at(1));
        const evald = await color.eval(context);
        expect(evald.toTrimmedString()).toBe('color: blue');
      });

      it('still sees later same-scope vars in Less mode', async () => {
        context = new Context({ leakyRules: true });
        getProp = getPropWithContext.bind(context, context);
        getVar = getVarWithContext.bind(context, context);
        getDeclEither = getDeclEitherWithContext.bind(context, context);

        let root = rules([
          decl({ name: 'total-width', value: ref('total-width', { type: 'variable' }) }),
          vardecl({ name: 'base', value: any('1') }),
          vardecl({ name: 'column-width', value: any('6em') }),
          vardecl({ name: 'gutter-width', value: any('2em') }),
          vardecl({ name: 'columns', value: any('12') }),
          vardecl({ name: 'gridsystem-width', value: any('96em') }),
          vardecl({ name: 'total-width', value: ref('gridsystem-width', { type: 'variable' }) })
        ]);

        root = await root.eval(context);
        const width = expectDeclarationNode(root.at(0));
        const evald = await width.eval(context);
        expect(evald.toTrimmedString()).toBe('total-width: 96em');
      });

      it('still sees later parent-scope vars from inside nested rulesets in Less mode', async () => {
        context = new Context({ leakyRules: true });
        getProp = getPropWithContext.bind(context, context);
        getVar = getVarWithContext.bind(context, context);
        getDeclEither = getDeclEitherWithContext.bind(context, context);

        let root = rules([
          ruleset({
            selector: el('.grid'),
            rules: rules([
              decl({ name: 'total-width', value: ref('total-width', { type: 'variable' }) })
            ])
          }),
          vardecl({ name: 'base', value: any('1') }),
          vardecl({ name: 'column-width', value: any('6em') }),
          vardecl({ name: 'gutter-width', value: any('2em') }),
          vardecl({ name: 'columns', value: any('12') }),
          vardecl({ name: 'gridsystem-width', value: any('96em') }),
          vardecl({ name: 'total-width', value: ref('gridsystem-width', { type: 'variable' }) })
        ]);

        root = await root.eval(context);
        const grid = root.at(0);
        if (!isNode(grid, N.Ruleset)) {
          throw new Error(`Expected Ruleset at index 0, got ${grid?.type ?? 'undefined'}`);
        }
        const width = expectDeclarationNode(grid.rules.at(0));
        context.rulesContext = grid.rules;
        const evald = await width.eval(context);
        expect(evald.toTrimmedString()).toBe('total-width: 96em');
      });

      it('shadows variables #1', async () => {
        let node = rules([
          vardecl({ name: 'one', value: any('one') }),
          rules([
            vardecl({ name: 'one', value: any('three') })
          ])
        ]);

        node = await node.eval(context);
        let inherited = node.at(1);
        expect(getVar(expectRulesNode(inherited), 'one')?.toTrimmedString()).toBe('$one: three');
      });

      it('shadows variables #2', async () => {
        let node = rules([
          vardecl({ name: 'one', value: any('one') }),
          rules([
            vardecl({ name: 'one', value: any('two') }),
            vardecl({ name: 'one', value: any('three') })
          ])
        ]);

        node = await node.eval(context);
        let inherited = node.at(1);
        expect(getVar(expectRulesNode(inherited), 'one')?.toTrimmedString()).toBe('$one: three');
      });

      it.skip('sets existing variables', async () => {
        let node = rules([
          vardecl({ name: 'one', value: any('one') }),
          rules([
            vardecl({ name: 'one', value: any('three') }, { setDefined: true })
          ])
        ]);

        node = await node.eval(context);
        // With direct setDefined lookup, the Rules node stays at index 1 (no array changes)
        let inherited = node.at(1);
        expect(getVar(node, 'one')?.toTrimmedString()).toBe('$one: three');
        expect(getVar(expectRulesNode(inherited), 'one')?.toTrimmedString()).toBe('$one := three');
      });

      it.skip('demonstrates setDefined behavior like Sass !global', async () => {
        let node = rules([
          // Original variable declaration
          vardecl({ name: 'color', value: any('red') }),

          // First rule that uses the original value
          rules([
            decl({ name: 'background', value: ref('color', { type: 'variable' }) })
          ]),

          // Nested rule that sets the variable with setDefined
          rules([
            vardecl({ name: 'color', value: any('blue') }, { setDefined: true })
          ]),

          // Subsequent rule that should use the updated value
          rules([
            decl({ name: 'border-color', value: ref('color', { type: 'variable' }) })
          ])
        ]);

        node = await node.eval(context);

        // The first rule should use the original value (red) - setDefined shouldn't affect earlier references
        let firstRule = expectRulesNode(node.at(1)); // First rule (background)
        let firstDecl = expectDeclarationNode(firstRule.at(0));
        let firstResult = await firstDecl.eval(context);
        expect(firstResult.toTrimmedString()).toBe('background: red');

        // The last rule should also use the updated value (blue)
        let lastRule = expectRulesNode(node.at(3)); // Last rule (border-color)
        let lastDecl = expectDeclarationNode(lastRule.at(0));
        let lastResult = await lastDecl.eval(context);
        expect(lastResult.toTrimmedString()).toBe('border-color: blue');

        // The root should have the updated value
        expect(getVar(node, 'color')?.toTrimmedString()).toBe('$color: blue');
      });

      it.skip('demonstrates Sass !global behavior with mixins - mixin resolves variables at include time', async () => {
        // This test demonstrates the Sass behavior where:
        // 1. A mixin is defined that uses a variable
        // 2. The mixin is included before a !global assignment - it uses the original value
        // 3. The mixin is included after a !global assignment - it uses the new value
        //
        // In Sass:
        //   $color: red;
        //   @mixin my-mixin() { color: $color; }
        //   .box { color: $color; @include my-mixin(); }
        //   .box2 { $color: blue !global; }
        //   .box3 { color: $color; @include my-mixin(); }
        //
        // Output:
        //   .box { color: red; color: red; }
        //   .box3 { color: blue; color: blue; }
        //
        // This test demonstrates Sass !global behavior with mixins using live resolution.
        //
        // Current syntax uses `$!color` for explicit source-position reads in
        // the live-binding model.
        //
        // When a mixin uses explicit live-binding syntax, the variable is resolved at the call site, allowing
        // !global assignments to affect mixin behavior correctly.

        let node = rules([
          // Global variable declaration
          vardecl({ name: 'color', value: any('red') }),

          // Mixin definition that uses explicit live-binding semantics.
          // This makes the mixin resolve the variable at call time, not definition time.
          mixin({
            name: any('my-mixin'),
            rules: rules([
              decl({ name: 'color', value: ref('color', { type: 'variable', resolution: 'live' }) })
            ], { rulesVisibility: { VarDeclaration: 'optional' } })
          }),

          // .box uses the variable directly and includes the mixin (both should be red)
          ruleset({
            selector: sellist([sel([el('.box')])]),
            rules: rules([
              decl({ name: 'color', value: ref('color', { type: 'variable' }) }),
              call({ name: ref('my-mixin', { type: 'mixin' }) })
            ])
          }),

          // .box2 sets the variable with !global (setDefined)
          ruleset({
            selector: sellist([sel([el('.box2')])]),
            rules: rules([
              vardecl({ name: 'color', value: any('blue') }, { setDefined: true })
            ])
          }),

          // .box3 uses the variable directly and includes the mixin (both should be blue)
          ruleset({
            selector: sellist([sel([el('.box3')])]),
            rules: rules([
              decl({ name: 'color', value: ref('color', { type: 'variable' }) }),
              call({ name: ref('my-mixin', { type: 'mixin' }) })
            ])
          })
        ]);

        node = await node.eval(context);

        // Structure after eval: [vardecl (0), mixin (1), boxRuleset (2), box2Ruleset (3), box3Ruleset (4)]
        // Access rulesets directly by index
        let boxRuleset = node.at(2);
        if (!boxRuleset || !isNode(boxRuleset, N.Ruleset)) {
          throw new Error(`Expected Ruleset at index 2, got ${boxRuleset?.type || 'undefined'}`);
        }
        // After evaluation, rulesets are still Rulesets, access via direct rules.
        let boxRules = boxRuleset.rules;
        if (!boxRules) {
          throw new Error('Expected .box ruleset to have rules');
        }
        // Rules is a Node with a value array, so use .value.length or check if it's a Rules node
        if (!isNode(boxRules, N.Rules)) {
          throw new Error(`Expected Rules, got ${boxRules?.type ?? 'undefined'}`);
        }
        expect(boxRules.rules.length).toBe(2);

        // First declaration: color: $color
        let boxDecl1 = await boxRules.at(0)!.eval(context);
        expect(boxDecl1.toTrimmedString()).toBe('color: red');

        // Second: mixin call
        let boxMixinCall = boxRules.at(1);
        if (!boxMixinCall) {
          throw new Error('Expected mixin call at index 1');
        }
        let boxMixinResult = await boxMixinCall.eval(context);
        // Mixin call returns Rules containing the mixin's rules
        if (!isNode(boxMixinResult, N.Rules)) {
          throw new Error('Expected mixin call to return Rules');
        }
        let boxMixinRules = boxMixinResult;
        expect(boxMixinRules.value.length).toBeGreaterThan(0);
        let boxMixinDecl = await boxMixinRules.at(0)!.eval(context);
        expect(boxMixinDecl.toTrimmedString()).toBe('color: red');

        // Find the .box3 ruleset (index 4)
        let box3Ruleset = node.at(4);
        if (!box3Ruleset || !isNode(box3Ruleset, N.Ruleset)) {
          throw new Error(`Expected Ruleset at index 4, got ${box3Ruleset?.type || 'undefined'}`);
        }
        let box3Rules = box3Ruleset.rules;
        if (!box3Rules) {
          throw new Error('Expected .box3 ruleset to have rules');
        }
        if (!isNode(box3Rules, N.Rules)) {
          throw new Error(`Expected Rules, got ${box3Rules?.type ?? 'undefined'}`);
        }
        expect(box3Rules.rules.length).toBe(2);

        // First declaration: color: $color
        let box3Decl1 = await box3Rules.at(0)!.eval(context);
        expect(box3Decl1.toTrimmedString()).toBe('color: blue');

        // Second: mixin call
        let box3MixinCall = box3Rules.at(1);
        if (!box3MixinCall) {
          throw new Error('Expected mixin call at index 1');
        }
        let box3MixinResult = await box3MixinCall.eval(context);
        if (!isNode(box3MixinResult, N.Rules)) {
          throw new Error('Expected mixin call to return Rules');
        }
        let box3MixinRules = box3MixinResult;
        expect(box3MixinRules.value.length).toBeGreaterThan(0);
        let box3MixinDecl = await box3MixinRules.at(0)!.eval(context);
        // With explicit live-binding syntax, the mixin should resolve the variable
        // at the call site, so it should be 'blue' (the value after !global assignment)
        expect(box3MixinDecl.toTrimmedString()).toBe('color: blue');

        // The root should have the updated value
        let rootColor = getVar(node, 'color');
        if (!rootColor) {
          throw new Error('Expected color variable to be defined');
        }
        expect(rootColor.toTrimmedString()).toBe('$color: blue');
      });

      it('fails to set if existing variable is readonly', async () => {
        let node = rules([
          vardecl({ name: 'one', value: any('one') }, { readonly: true }),
          rules([
            vardecl({ name: 'one', value: any('three') }, { setDefined: true })
          ])
        ]);

        await expect(async () => {
          await node.eval(context);
        }).rejects.toThrowError('"one" is readonly');
      });

      it('derives setDefined declarations without calling VarDeclaration.copy()', async () => {
        const originalCopy = VarDeclaration.prototype.copy;
        let copyCalls = 0;
        VarDeclaration.prototype.copy = function copyForCounting(
          ...args: Parameters<typeof originalCopy>
        ): ReturnType<typeof originalCopy> {
          copyCalls++;
          return originalCopy.apply(this, args);
        };
        const assignment = vardecl(
          { name: 'one', value: spaced([any('three'), any('px')]) },
          { setDefined: true }
        );
        const node = rules([
          vardecl({ name: 'one', value: any('one') }),
          rules([assignment])
        ]);

        try {
          await node.eval(context);

          expect(copyCalls).toBe(0);
        } finally {
          VarDeclaration.prototype.copy = originalCopy;
        }
      });

      it('updates static setDefined variables without deriving placement declarations', async () => {
        const assignment = vardecl(
          { name: 'one', value: any('three') },
          { setDefined: true }
        );
        let deriveCalls = 0;
        assignment.deriveWithOptions = function countDerive(
          ...args: Parameters<typeof assignment.deriveWithOptions>
        ): ReturnType<typeof assignment.deriveWithOptions> {
          deriveCalls++;
          return VarDeclaration.prototype.deriveWithOptions.apply(this, args);
        };
        const node = rules([
          vardecl({ name: 'one', value: any('one') }),
          rules([assignment]),
          decl({ name: 'seen', value: ref({ key: 'one' }, { type: 'variable' }) })
        ]);

        const evald = await node.eval(context);

        expect(await renderNodeToString(evald, context)).toBeString(`
          seen: three;
        `);
        expect(deriveCalls).toBe(0);
      });

      it('updates modeled setDefined live binding cells without direct occurrence crawl', () => {
        const assignment = vardecl(
          { name: 'one', value: any('three') },
          { setDefined: true }
        );
        const node = rules([
          vardecl({ name: 'one', value: any('one') }),
          assignment
        ]);
        const frame = node.getScopeFrame(undefined, false);
        setScopeFrameLiveBinding(frame, 'one', {
          value: any('one')
        });
        const originalValue = node.value;

        Object.defineProperty(node, 'value', {
          configurable: true,
          get() {
            throw new Error('setDefined current-cell path should not crawl Rules.value');
          }
        });

        try {
          node.registerNode(assignment, undefined, context);
        } finally {
          Object.defineProperty(node, 'value', {
            configurable: true,
            writable: true,
            value: originalValue
          });
        }

        expect(frame.currentBindingsByName.get('one')?.value?.toString()).toBe('three');
      });

      it('does not build a scope frame just to try setDefined live binding writes', () => {
        const assignment = vardecl(
          { name: 'one', value: any('three') },
          { setDefined: true }
        );
        const node = rules([
          vardecl({ name: 'one', value: any('one') }),
          assignment
        ]);

        node.registerNode(assignment, undefined, context);

        expect(node._scopeFrame).toBeUndefined();
        expect(getVarWithContext(context, node, 'one')?.toTrimmedString()).toBe('$one: three');
      });

      // @todo: Fix nested readonly rules inheritance - variables in nested readonly Rules aren't being found
      it.skip('fails to set if existing variable is in readonly rules', async () => {
        let node = rules([
          rules([
            vardecl({ name: 'one', value: any('one') })
          ], {
            readonly: true,
            rulesVisibility: { VarDeclaration: 'public' }
          }),
          rules([
            vardecl({ name: 'one', value: any('three') }, { setDefined: true })
          ])
        ]);

        await expect(async () => {
          await node.eval(context);
        }).rejects.toThrowError('"one" is readonly');
      });

      // @todo: Fix nested readonly rules inheritance - variables in nested readonly Rules aren't being found
      it.skip('fails to set if existing variable is in nested readonly rules #1', async () => {
        let node = rules([
          rules([
            rules([
              vardecl({ name: 'one', value: any('one') })
            ], {
              readonly: true,
              rulesVisibility: { VarDeclaration: 'public' }
            })
          ], {
            rulesVisibility: { VarDeclaration: 'public' }
          }),
          rules([
            vardecl({ name: 'one', value: any('three') }, { setDefined: true })
          ])
        ]);

        await expect(async () => {
          await node.eval(context);
        }).rejects.toThrowError('"one" is readonly');
      });

      // @todo: Fix nested readonly rules inheritance - variables in nested readonly Rules aren't being found
      it.skip('fails to set if existing variable is in nested readonly rules #2', async () => {
        let node = rules([
          rules([
            rules([
              vardecl({ name: 'one', value: any('one') })
            ], {
              rulesVisibility: { VarDeclaration: 'public' }
            })
          ], {
            readonly: true,
            rulesVisibility: { VarDeclaration: 'public' }
          }),
          rules([
            vardecl({ name: 'one', value: any('three') }, { setDefined: true })
          ])
        ]);

        await expect(async () => {
          await node.eval(context);
        }).rejects.toThrowError('"one" is readonly');
      });

      it('doesn\'t preserve readonly later', async () => {
        let node = rules([
          rules([
            vardecl({ name: 'one', value: any('one') })
          ], {
            readonly: true,
            rulesVisibility: { VarDeclaration: 'public' }
          }),
          rules([
            vardecl({ name: 'one', value: any('two') })
          ], {
            rulesVisibility: { VarDeclaration: 'public' }
          }),
          rules([
            /** This will set after the second rules value */
            vardecl({ name: 'one', value: any('three') }, { setDefined: true })
          ])
        ]);

        const result = node.eval(context);
        if (result instanceof Promise) {
          await expect(result).resolves.not.toThrow();
        } else {
          // Synchronous result, no error thrown
          expect(result).toBeDefined();
        }
      });

      it('looks upwards from position', async () => {
        let node = rules([
          vardecl({ name: 'one', value: any('one') }),
          vardecl({ name: 'one', value: any('two') }),
          vardecl({ name: 'one', value: any('three') })
        ]);
        node = await node.eval(context);

        expect(getVar(node, 'one', { start: node.at(1)?.index })?.toTrimmedString()).toBe('$one: one');
        expect(getVar(node, 'one', { start: node.at(2)?.index })?.toTrimmedString()).toBe('$one: two');
        expect(getVar(node, 'one', { start: 10 })?.toTrimmedString()).toBe('$one: three');
      });

      it('won\'t find variables in sub-rules of local rules', async () => {
        let node = rules([ // root.jess
          rules([ // @-compose('child1.jess')
            vardecl({ name: 'foo', value: any('bar') }),
            rules([ // @-compose('child2.jess')
              vardecl({ name: 'one', value: any('two') })
            ], {
              local: true,
              rulesVisibility: { VarDeclaration: 'public' }
            })
          ], {
            local: true,
            rulesVisibility: { VarDeclaration: 'public' }
          })
        ]);
        node = await node.eval(context);

        // child1.jess should see child2.jess's vars because it owns the `@use`
        const childRules = expectRulesNode(node.at(0));
        expect(getVar(childRules, 'one')?.toTrimmedString()).toBe('$one: two');
        // child1.jess can still see its own vars
        expect(getVar(childRules, 'foo')?.toTrimmedString()).toBe('$foo: bar');
        // root.jess can see child1.jess's vars but not child2.jess's
        expect(getVar(node, 'foo')?.toTrimmedString()).toBe('$foo: bar');
        expect(getVar(node, 'one')).toBeUndefined();
      });
    });
  });

  /** IT IS TIME */
  // describe('lookup selectors', () => {
  //   it('can lookup a simple ruleset', async () => {
  //     let node = rules([
  //       ruleset({
  //         selector: el('.foo'),
  //         rules: rules([
  //           decl({ name: 'foo', value: any('bar') })
  //         ])
  //       })
  //     ]);
  //     node = await node.eval(context);

  //     expect(getSelector(node, 'foo')).toBe('foo: bar');
  //   });
  // });

  it('should flatten rules when serializing', async () => {
    let node = rules([
      ruleset({
        selector: sellist([sel([el('.collapse')])]),
        rules: rules([
          decl({ name: 'chungus', value: spaced([any('foo'), any('bar')]) }),
          rules([
            decl({ name: 'bird', value: spaced([any('in'), any('hand')]) })
          ])
        ])
      })
    ]);
    let evald = await node.eval(context);
    expect(await renderNodeToString(evald, context)).toBe('.collapse {\n  chungus: foo bar;\n  bird: in hand;\n}\n');
  });
});
