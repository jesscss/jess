import {
  ruleset,
  sel,
  el,
  sellist,
  rules,
  decl,
  vardecl,
  spaced,
  any,
  call,
  ref,
  mixin,
  Node,
  type Rules,
  AssignmentType,
  VarDeclaration,
  style,
  quoted,
  type Declaration,
  type Selector
} from '../index.js';
import { Context, TreeContext } from '../../context.js';
import type { FindOptions } from '../util/registry-utils.js';
import { isNode } from '../util/is-node.js';
import { N } from '../node-type.js';
import { getPrintOptions, OutputWriter } from '../util/print.js';

let context: Context;

function getPropWithContext(context: Context, n: Rules, key: string, opts: FindOptions = {}) {
  context.rulesContext = n;
  opts.searchParents = true;
  return n.find('declaration', key, 'Declaration', opts);
}

function getVarWithContext(context: Context, n: Rules, key: string, opts: FindOptions = {}) {
  context.rulesContext = n;
  opts.searchParents = true;
  let decl = n.find('declaration', key, 'VarDeclaration', opts);
  return decl;
}

function getDeclEitherWithContext(context: Context, n: Rules, key: string, opts: FindOptions = {}) {
  context.rulesContext = n;
  opts.searchParents = true;
  return n.find('declaration', key, undefined, opts);
}

// function getSelectorWithContext(context: Context, n: Rules, key: Selector, opts: FindOptions = {}, start?: number) {
//   context.rulesContext = n;
//   opts.searchParents = true;
//   let decl = n.findDeclaration(key, 'VarDeclaration', opts);
//   return decl;
// }

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
    expect((node.at(2) as Rules).at(0)?.index).toBeGreaterThan(index);
    index = (node.at(2) as Rules).at(1)?.index ?? index;
    expect((node.at(2) as Rules).at(2)?.index).toBeGreaterThan(index);
    expect(((node.at(2) as Rules).at(2) as Rules).at(0)?.index).toBeGreaterThan(index);
  });

  it('keeps Rules render flags and renderKey render-local', () => {
    const renderKey = Symbol('outer-render');
    const node = rules([
      decl({ name: 'color', value: any('red') })
    ], {
      referenceMode: true
    });
    const options = getPrintOptions({
      writer: new OutputWriter(),
      referenceMode: false,
      referenceRenderEnabled: true,
      renderKey
    });

    const out = node.toTrimmedString(options);

    expect(out).toBe('color: red;');
    expect(options.referenceMode).toBe(false);
    expect(options.referenceRenderEnabled).toBe(true);
    expect(options.renderKey).toBe(renderKey);
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

  it('reuses context-owned print state for explicit toString options with context', () => {
    const node = rules([
      decl({ name: 'color', value: any('red') })
    ]);

    const first = node.toString({ context, writer: new OutputWriter() });
    const second = node.toString({ context, writer: new OutputWriter() });

    expect(first).toBe('color: red;\n');
    expect(second).toBe('color: red;\n');
    expect(context.printState.writer?.toString()).toBe('color: red;');
  });

  describe('Scope / lookups', () => {
    describe('set / get vars & props', () => {
      it('can do a normal get / set of properties', async () => {
        let node = rules([
          decl({ name: 'foo', value: any('bar') })
        ]);
        node = await node.eval(context);

        expect(`${getProp(node, 'foo')}`).toBe('foo: bar');
      });

      it('can do a normal get / set of variables', async () => {
        let node = rules([
          vardecl({ name: 'foo', value: any('bar') })
        ]);
        node = await node.eval(context);
        expect(`${getVar(node, 'foo')}`).toBe('$foo: bar');
      });

      it('find(declaration, key, undefined) picks VarDeclaration or Declaration by source order', async () => {
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
        expect(`${getVar(node, 'foo')}`).toBe('$foo: two');
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
        expect(`${result}`).toBe('$first: one');
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
        target.eval = (() => {
          attempts += 1;
          throw new Error('content-eval-failure');
        }) as typeof target.eval;

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
        expect(`${getVar(inherited, 'foo')}`).toBe('$foo: bar');
      });

      it('inherits values when set after', async () => {
        let inherited = rules([]);
        let node = rules([
          inherited
        ]);
        node.push(vardecl({ name: 'foo', value: any('bar') }));

        node = await node.eval(context);
        expect(`${getVar(inherited, 'foo')}`).toBe('$foo: bar');
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
        expect(`${getVar(node, 'one')}`).toBe('$one: two');
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
        expect(`${getVar(node, 'one')}`).toBe('$one: one');
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
        expect(`${getVar(node, 'one')}`).toBe('$one: optional-value');
        // Should find public value
        expect(`${getVar(node, 'two')}`).toBe('$two: public-value');
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
        expect(`${getVar(node, 'var')}`).toBe('$var: third');

        // Test with start parameter - should find value before start position
        const thirdVar = node.value.find(n => isNode(n, N.VarDeclaration) && n.value.name.valueOf() === 'var' && n.value.value.valueOf() === 'third');
        if (thirdVar && 'index' in thirdVar) {
          const result = getVar(node, 'var', { start: thirdVar.index });
          expect(result).toBeDefined();
          expect(`${result}`).toBe('$var: second');
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
        expect(`${getVar(node, 'nested')}`).toBe('$nested: public-nested');
        // Should find public value, not optional deep value
        expect(`${getVar(node, 'deep')}`).toBe('$deep: public-deep');
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
        expect(`${getVar(node, 'var')}`).toBe('$var: optional-third');
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
        expect(`${getVar(node, 'var')}`).toBe('$var: root-third');

        // Test with start parameter pointing to root-third
        const thirdVar = node.value.find(n => isNode(n, N.VarDeclaration) && n.value.name.valueOf() === 'var' && n.value.value.valueOf() === 'root-third');
        if (thirdVar && 'index' in thirdVar) {
          const result = getVar(node, 'var', { start: thirdVar.index });
          expect(result).toBeDefined();
          // Should find root-second (before start), not optional value
          expect(`${result}`).toBe('$var: root-second');
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
        expect(`${getVar(node, 'var')}`).toBe('$var: public-2');
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
        expect(`${getVar(node, 'var')}`).toBe('$var: parent-2');

        // Test lookup from within child Rules - should find its own value
        // Optional declarations are fallback-only and should not overtake public declarations
        // that are reachable in the lookup chain.
        const childVar = getVar(childRules, 'var');
        expect(childVar).toBeDefined();
        expect(`${childVar}`).toBe('$var: parent-2');
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
        expect(`${getVar(node, 'a')}`).toBe('$a: public-a');
        // Should find public-b, ignoring optional-b-1 and optional-b-2
        expect(`${getVar(node, 'b')}`).toBe('$b: public-b');
        // Should find optional-c since no public c exists
        expect(`${getVar(node, 'c')}`).toBe('$c: optional-c');
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
        expect(context.renderKey).toBeUndefined();
        const scope1 = root.at(1) as any;
        const scope2 = scope1.value.rules.at(1) as any;
        const scope3 = scope2.value.rules.at(0) as any;
        const scope3Rules = scope3.value.rules as Rules;
        expect(`${getVar(scope3Rules, 'z', { start: 0 })}`).toBe('$z: black');
        const scope3Found = scope3Rules.find('declaration', 'z', 'VarDeclaration', {
          filter: () => true,
          context,
          hasTarget: false,
          renderKey: context.renderKey,
          searchParents: true,
          start: 0
        });
        expect(`${scope3Found}`).toBe('$z: black');
        const border = scope3Rules.at(0) as Declaration;
        context.rulesContext = scope3Rules;
        const evald = await border.eval(context);
        expect(`${evald}`).toBe('border-color: black');
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
        const color = root.at(1) as Declaration;
        const evald = await color.eval(context);
        expect(`${evald}`).toBe('color: blue');
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
        const width = root.at(0) as Declaration;
        const evald = await width.eval(context);
        expect(`${evald}`).toBe('total-width: 96em');
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
        const grid = root.at(0) as any;
        const width = grid.value.rules.at(0) as Declaration;
        context.rulesContext = grid.value.rules;
        const evald = await width.eval(context);
        expect(`${evald}`).toBe('total-width: 96em');
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
        expect(`${getVar(inherited as Rules, 'one')}`).toBe('$one: three');
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
        expect(`${getVar(inherited as Rules, 'one')}`).toBe('$one: three');
      });

      it.skip('sets existing variables', async () => {
        let node = rules([
          vardecl({ name: 'one', value: any('one') }),
          rules([
            vardecl({ name: 'one', value: any('three') }, { setDefined: true })
          ])
        ]);

        node = await node.eval(context);
        // With registry-based setDefined, the Rules node stays at index 1 (no array changes)
        let inherited = node.at(1);
        expect(`${getVar(node, 'one')}`).toBe('$one: three');
        expect(`${getVar(inherited as Rules, 'one')}`).toBe('$one := three');
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
        let firstRule = node.at(1) as Rules; // First rule (background)
        let firstDecl = firstRule.at(0) as Declaration;
        let firstResult = await firstDecl.eval(context);
        expect(`${firstResult}`).toBe('background: red');

        // The last rule should also use the updated value (blue)
        let lastRule = node.at(3) as Rules; // Last rule (border-color)
        let lastDecl = lastRule.at(0) as Declaration;
        let lastResult = await lastDecl.eval(context);
        expect(`${lastResult}`).toBe('border-color: blue');

        // The root should have the updated value
        expect(`${getVar(node, 'color')}`).toBe('$color: blue');
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
        // Solution implemented: `$~color` syntax for live resolution.
        // - `$color` = scoped lookup (Less-style)
        // - `$^color` = linear lookup from definition position (Sass-style for regular code)
        // - `$~color` = linear lookup from call site position (Sass-style for mixins/functions)
        //
        // When a mixin uses `$~color`, the variable is resolved at the call site, allowing
        // !global assignments to affect mixin behavior correctly.

        let node = rules([
          // Global variable declaration
          vardecl({ name: 'color', value: any('red') }),

          // Mixin definition that uses the variable with live resolution
          // In Jess, this would be: my-mixin() { color: $~color; }
          // This makes the mixin resolve the variable at call time, not definition time
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
        // After evaluation, rulesets are still Rulesets, access via .value.rules
        let boxRules = boxRuleset.value.rules;
        if (!boxRules) {
          throw new Error('Expected .box ruleset to have rules');
        }
        // Rules is a Node with a value array, so use .value.length or check if it's a Rules node
        if (!isNode(boxRules, N.Rules)) {
          throw new Error(`Expected Rules, got ${(boxRules as any)?.type || 'undefined'}`);
        }
        expect(boxRules.value.length).toBe(2);

        // First declaration: color: $color
        let boxDecl1 = await boxRules.at(0)!.eval(context);
        expect(`${boxDecl1}`).toBe('color: red');

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
        expect(`${boxMixinDecl}`).toBe('color: red');

        // Find the .box3 ruleset (index 4)
        let box3Ruleset = node.at(4);
        if (!box3Ruleset || !isNode(box3Ruleset, N.Ruleset)) {
          throw new Error(`Expected Ruleset at index 4, got ${box3Ruleset?.type || 'undefined'}`);
        }
        let box3Rules = box3Ruleset.value.rules;
        if (!box3Rules) {
          throw new Error('Expected .box3 ruleset to have rules');
        }
        if (!isNode(box3Rules, N.Rules)) {
          throw new Error(`Expected Rules, got ${(box3Rules as any)?.type || 'undefined'}`);
        }
        expect(box3Rules.value.length).toBe(2);

        // First declaration: color: $color
        let box3Decl1 = await box3Rules.at(0)!.eval(context);
        expect(`${box3Decl1}`).toBe('color: blue');

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
        // With live resolution ($~color), the mixin should resolve the variable
        // at the call site, so it should be 'blue' (the value after !global assignment)
        expect(`${box3MixinDecl}`).toBe('color: blue');

        // The root should have the updated value
        let rootColor = getVar(node, 'color');
        if (!rootColor) {
          throw new Error('Expected color variable to be defined');
        }
        expect(`${rootColor}`).toBe('$color: blue');
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

        expect(`${getVar(node, 'one', { start: node.at(1)?.index })}`).toBe('$one: one');
        expect(`${getVar(node, 'one', { start: node.at(2)?.index })}`).toBe('$one: two');
        expect(`${getVar(node, 'one', { start: 10 })}`).toBe('$one: three');
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
        expect(`${getVar(node.at(0) as Rules, 'one')}`).toBe('$one: two');
        // child1.jess can still see its own vars
        expect(`${getVar(node.at(0) as Rules, 'foo')}`).toBe('$foo: bar');
        // root.jess can see child1.jess's vars but not child2.jess's
        expect(`${getVar(node, 'foo')}`).toBe('$foo: bar');
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
    expect(`${evald}`).toBe('.collapse {\n  chungus: foo bar;\n  bird: in hand;\n}\n');
  });
});
