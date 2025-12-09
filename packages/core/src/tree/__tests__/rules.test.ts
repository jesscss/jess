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
  type Declaration,
  type Selector
} from '..';
import { Context, TreeContext } from '../../context';
import type { FindOptions } from '../util/registry-utils';
import { isNode } from '../util/is-node';

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
  // let getSelector = getSelectorWithContext.bind(context, context);
  beforeEach(() => {
    context = new Context();
    getProp = getPropWithContext.bind(context, context);
    getVar = getVarWithContext.bind(context, context);
    // getSelector = getSelectorWithContext.bind(context, context);
    context.id = 'testing';
  });

  it('assigns position linearly for nested rules', async () => {
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

      it('replaces variable values', async () => {
        let node = rules([
          vardecl({ name: 'foo', value: any('one') }),
          vardecl({ name: 'foo', value: any('two') })
        ]);
        node = await node.eval(context);
        expect(`${getVar(node, 'foo')}`).toBe('$foo: two');
      });

      it('will not set if defined', async () => {
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
        }).toThrow('"first" is not defined');
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
          ])
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

      it('sets existing variables', async () => {
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
        expect(`${getVar(inherited as Rules, 'one')}`).toBe('$^one: three');
      });

      it('demonstrates setDefined behavior like Sass !global', async () => {
        let node = rules([
          // Original variable declaration
          vardecl({ name: 'color', value: any('red') }),

          // First rule that uses the original value
          rules([
            decl({ name: 'background', value: ref('color', { type: 'variable', resolution: 'linear' }) })
          ]),

          // Nested rule that sets the variable with setDefined
          rules([
            vardecl({ name: 'color', value: any('blue') }, { setDefined: true })
          ]),

          // Subsequent rule that should use the updated value
          rules([
            decl({ name: 'border-color', value: ref('color', { type: 'variable', resolution: 'linear' }) })
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

      it('demonstrates Sass !global behavior with mixins - mixin resolves variables at include time', async () => {
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
        // This test demonstrates Sass !global behavior with mixins using call-time resolution.
        //
        // Solution implemented: `$~color` syntax for call-time resolution.
        // - `$color` = scoped lookup (Less-style)
        // - `$^color` = linear lookup from definition position (Sass-style for regular code)
        // - `$~color` = linear lookup from call site position (Sass-style for mixins/functions)
        //
        // When a mixin uses `$~color`, the variable is resolved at the call site, allowing
        // !global assignments to affect mixin behavior correctly.

        let node = rules([
          // Global variable declaration
          vardecl({ name: 'color', value: any('red') }),

          // Mixin definition that uses the variable with call-time resolution
          // In Jess, this would be: my-mixin() { color: $~color; }
          // This makes the mixin resolve the variable at call time, not definition time
          mixin({
            name: any('my-mixin'),
            rules: rules([
              decl({ name: 'color', value: ref('color', { type: 'variable', resolution: 'call-time' }) })
            ])
          }),

          // .box uses the variable directly and includes the mixin (both should be red)
          ruleset({
            selector: sellist([sel([el('.box')])]),
            rules: rules([
              decl({ name: 'color', value: ref('color', { type: 'variable', resolution: 'linear' }) }),
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
              decl({ name: 'color', value: ref('color', { type: 'variable', resolution: 'linear' }) }),
              call({ name: ref('my-mixin', { type: 'mixin' }) })
            ])
          })
        ]);

        node = await node.eval(context);

        // Structure after eval: [vardecl (0), mixin (1), boxRuleset (2), box2Ruleset (3), box3Ruleset (4)]
        // Access rulesets directly by index
        let boxRuleset = node.at(2);
        if (!boxRuleset || !isNode(boxRuleset, 'Ruleset')) {
          throw new Error(`Expected Ruleset at index 2, got ${boxRuleset?.type || 'undefined'}`);
        }
        // After evaluation, rulesets are still Rulesets, access via .value.rules
        let boxRules = boxRuleset.value.rules;
        if (!boxRules) {
          throw new Error('Expected .box ruleset to have rules');
        }
        // Rules is a Node with a value array, so use .value.length or check if it's a Rules node
        if (!isNode(boxRules, 'Rules')) {
          throw new Error(`Expected Rules, got ${boxRules.type}`);
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
        if (!isNode(boxMixinResult, 'Rules')) {
          throw new Error('Expected mixin call to return Rules');
        }
        let boxMixinRules = boxMixinResult;
        expect(boxMixinRules.value.length).toBeGreaterThan(0);
        let boxMixinDecl = await boxMixinRules.at(0)!.eval(context);
        expect(`${boxMixinDecl}`).toBe('color: red;');

        // Find the .box3 ruleset (index 4)
        let box3Ruleset = node.at(4);
        if (!box3Ruleset || !isNode(box3Ruleset, 'Ruleset')) {
          throw new Error(`Expected Ruleset at index 4, got ${box3Ruleset?.type || 'undefined'}`);
        }
        let box3Rules = box3Ruleset.value.rules;
        if (!box3Rules) {
          throw new Error('Expected .box3 ruleset to have rules');
        }
        if (!isNode(box3Rules, 'Rules')) {
          throw new Error(`Expected Rules, got ${box3Rules.type}`);
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
        if (!isNode(box3MixinResult, 'Rules')) {
          throw new Error('Expected mixin call to return Rules');
        }
        let box3MixinRules = box3MixinResult;
        expect(box3MixinRules.value.length).toBeGreaterThan(0);
        let box3MixinDecl = await box3MixinRules.at(0)!.eval(context);
        // With call-time resolution ($~color), the mixin should resolve the variable
        // at the call site, so it should be 'blue' (the value after !global assignment)
        expect(`${box3MixinDecl}`).toBe('color: blue;');

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

      it('fails to set if existing variable is in readonly rules', async () => {
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

      it('fails to set if existing variable is in nested readonly rules #1', async () => {
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

      it('fails to set if existing variable is in nested readonly rules #2', async () => {
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
    expect(`${evald}`).toBe('.collapse {\n  chungus: foo bar;\n  bird: in hand;\n}');
  });
});