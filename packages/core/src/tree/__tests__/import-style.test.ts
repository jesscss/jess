import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import {
  style,
  rules,
  sel,
  el,
  sellist,
  decl,
  vardecl,
  any,
  ref,
  ruleset,
  mixin,
  call,
  quoted,
  type Rules,
  Node
} from '..';
import { isNode } from '../util/is-node';
import { Context } from '../../context';
import type { FindOptions } from '../util/registry-utils';
import { resolve } from 'node:path';
import { createTestContext } from './import-style-test-helpers';

let context: Context;

function getVarWithContext(context: Context, n: Rules, key: string, opts: FindOptions = {}) {
  context.rulesContext = n;
  opts.searchParents = true;
  return n.find('declaration', key, 'VarDeclaration', opts);
}

function getMixinWithContext(context: Context, n: Rules, key: string, opts: FindOptions = {}) {
  context.rulesContext = n;
  opts.searchParents = true;
  return n.find('mixin', key, 'Mixin', opts);
}

function getRulesetWithContext(context: Context, n: Rules, keys: string | string[], opts: FindOptions = {}) {
  context.rulesContext = n;
  opts.searchParents = true;
  const keySet = typeof keys === 'string' ? [keys] : keys;
  return n.find('ruleset', keySet, undefined, opts);
}

describe('Style import', () => {
  beforeAll(() => {
    Node.prototype.fullRender = true;
  });

  beforeEach(() => {
    context = createTestContext();
  });

  describe('variable visibility', () => {
    it('import type can see parent rules variables', async () => {
      // Set up imported file - use absolute path
      const importedPath = resolve(process.cwd(), 'imported.jess');
      context.sourceTrees.set(importedPath, rules([
        ruleset({
          selector: sellist([sel([el('.imported')])]),
          rules: rules([
            decl({ name: any('color'), value: ref('parentVar', { type: 'variable' }) })
          ])
        })
      ]));

      // Parent file with variable
      const parentVar = vardecl({ name: 'parentVar', value: any('red') });
      const node = rules([
        parentVar,
        style({
          path: quoted(any('imported.jess'))
        }, {
          type: 'import'
        })
      ]);

      const evald = await node.eval(context);
      const importedRules = evald.at(1) as Rules;
      const importedRuleset = importedRules.at(0);

      // The imported ruleset should be able to reference the parent variable
      // The declaration should already be evaluated as part of the ruleset evaluation
      const importedDecl = (importedRuleset as any).value.rules.at(0);
      expect(`${importedDecl}`).toBe('color: red');
    });

    it('compose type cannot see parent rules variables', async () => {
      // Set up imported file
      const composedPath = resolve(process.cwd(), 'composed.jess');
      context.sourceTrees.set(composedPath, rules([
        ruleset({
          selector: sellist([sel([el('.composed')])]),
          rules: rules([
            decl({ name: any('color'), value: ref('parentVar', { type: 'variable', fallbackValue: any('blue') }) })
          ])
        })
      ]));

      // Parent file with variable
      const parentVar = vardecl({ name: 'parentVar', value: any('red') });
      const node = rules([
        parentVar,
        style({
          path: quoted(any('composed.jess'))
        }, {
          type: 'compose',
          namespace: '*'
        })
      ]);

      const evald = await node.eval(context);
      const composedRules = evald.at(1) as Rules;
      const composedRuleset = composedRules.at(0);

      // The composed ruleset should NOT be able to reference the parent variable
      // It should use the fallback value instead
      const composedDecl = (composedRuleset as any).value.rules.at(0);
      const resolved = await composedDecl.eval(context);
      expect(`${resolved}`).toBe('color: blue');
    });

    it('import type variables are visible to parent', async () => {
      context.sourceTrees.set('imported.jess', rules([
        vardecl({ name: 'importedVar', value: any('green') })
      ]));

      const node = rules([
        style({
          path: quoted(any('imported.jess'))
        }, {
          type: 'import'
        }),
        ruleset({
          selector: sellist([sel([el('.parent')])]),
          rules: rules([
            decl({ name: any('color'), value: ref('importedVar', { type: 'variable' }) })
          ])
        })
      ]);

      const evald = await node.eval(context);
      const parentRuleset = evald.at(1);
      const parentDecl = (parentRuleset as any).value.rules.at(0);
      const resolved = await parentDecl.eval(context);
      expect(`${resolved}`).toBe('color: green');
    });

    it('compose type variables are visible to parent', async () => {
      const composedPath = resolve(process.cwd(), 'composed.jess');
      context.sourceTrees.set(composedPath, rules([
        vardecl({ name: 'composedVar', value: any('purple') })
      ]));

      const node = rules([
        style({
          path: quoted(any('composed.jess'))
        }, {
          type: 'compose',
          namespace: '*'
        }),
        ruleset({
          selector: sellist([sel([el('.parent')])]),
          rules: rules([
            decl({ name: any('color'), value: ref('composedVar', { type: 'variable' }) })
          ])
        })
      ]);

      const evald = await node.eval(context);
      const parentRuleset = evald.at(1);
      const parentDecl = (parentRuleset as any).value.rules.at(0);
      const resolved = await parentDecl.eval(context);
      // Should use composedVar from the compose
      expect(`${resolved}`).toBe('color: purple');
    });
  });

  describe('mixin visibility', () => {
    it('import type mixins are visible to parent', async () => {
      context.sourceTrees.set('imported.jess', rules([
        mixin({
          name: any('importedMixin'),
          rules: rules([
            decl({ name: any('color'), value: any('blue') })
          ])
        })
      ]));

      const node = rules([
        style({
          path: quoted(any('imported.jess'))
        }, {
          type: 'import'
        }),
        ruleset({
          selector: sellist([sel([el('.parent')])]),
          rules: rules([
            call({ name: ref('importedMixin', { type: 'mixin' }) })
          ])
        })
      ]);

      const evald = await node.eval(context);
      const parentRuleset = evald.at(1);
      const mixinCall = (parentRuleset as any).value.rules.at(0);
      const resolved = await mixinCall.eval(context);
      expect(`${resolved}`).toContainString('color: blue');
    });

    it('compose type mixins are visible to parent', async () => {
      const composedPath = resolve(process.cwd(), 'composed.jess');
      context.sourceTrees.set(composedPath, rules([
        mixin({
          name: any('composedMixin'),
          rules: rules([
            decl({ name: any('color'), value: any('yellow') })
          ])
        })
      ]));

      const node = rules([
        style({
          path: quoted(any('composed.jess'))
        }, {
          type: 'compose',
          namespace: '*'
        }),
        ruleset({
          selector: sellist([sel([el('.parent')])]),
          rules: rules([
            call({ name: ref('composedMixin', { type: 'mixin' }) })
          ])
        })
      ]);

      const evald = await node.eval(context);
      const parentRuleset = evald.at(1);
      const mixinCall = (parentRuleset as any).value.rules.at(0);
      const resolved = await mixinCall.eval(context);
      expect(`${resolved}`).toContainString('color: yellow');
    });

    it('reference import makes mixins optional', async () => {
      const referencedPath = resolve(process.cwd(), 'referenced.jess');
      context.sourceTrees.set(referencedPath, rules([
        mixin({
          name: any('referencedMixin'),
          rules: rules([
            decl({ name: any('color'), value: any('white') })
          ])
        })
      ]));

      // First try to use it directly - should work
      const node1 = rules([
        style({
          path: quoted(any('referenced.jess'))
        }, {
          type: 'import',
          importOptions: { reference: true }
        }),
        ruleset({
          selector: sellist([sel([el('.parent')])]),
          rules: rules([
            call({ name: ref('referencedMixin', { type: 'mixin' }) })
          ])
        })
      ]);

      const evald1 = await node1.eval(context);
      const parentRuleset1 = evald1.at(1);
      const mixinCall1 = (parentRuleset1 as any).value.rules.at(0);
      const resolved1 = await mixinCall1.eval(context);
      expect(`${resolved1}`).toContainString('color: white');
    });
  });

  describe('ruleset visibility', () => {
    it('import type rulesets are visible to parent', async () => {
      context.sourceTrees.set('imported.jess', rules([
        ruleset({
          selector: sellist([sel([el('.imported')])]),
          rules: rules([
            decl({ name: any('color'), value: any('red') })
          ])
        })
      ]));

      const node = rules([
        style({
          path: quoted(any('imported.jess'))
        }, {
          type: 'import'
        })
      ]);

      const evald = await node.eval(context);
      const importedRules = evald.at(0) as Rules;
      const importedRuleset = importedRules.at(0);
      expect(importedRuleset).toBeDefined();
      expect(`${importedRuleset}`).toContainString('.imported');
    });

    it('protected import makes rulesets private', async () => {
      const protectedPath = resolve(process.cwd(), 'protected.jess');
      context.sourceTrees.set(protectedPath, rules([
        ruleset({
          selector: sellist([sel([el('.protected')])]),
          rules: rules([
            decl({ name: any('color'), value: any('green') })
          ])
        })
      ]));

      const node = rules([
        style({
          path: quoted(any('protected.jess'))
        }, {
          type: 'import',
          importOptions: { protected: true }
        })
      ]);

      const evald = await node.eval(context);
      const importedRules = evald.at(0) as Rules;
      // Ruleset should still exist but be private
      const protectedRuleset = importedRules.at(0);
      expect(protectedRuleset).toBeDefined();
      // But it should not be findable via registry lookup
      const found = getRulesetWithContext(context, evald, '.protected');
      expect(found).toBeUndefined();
    });

    it('reference import makes rulesets optional', async () => {
      const referencedPath = resolve(process.cwd(), 'referenced.jess');
      context.sourceTrees.set(referencedPath, rules([
        ruleset({
          selector: sellist([sel([el('.referenced')])]),
          rules: rules([
            decl({ name: any('color'), value: any('blue') })
          ])
        })
      ]));

      const node = rules([
        style({
          path: quoted(any('referenced.jess'))
        }, {
          type: 'import',
          importOptions: { reference: true }
        })
      ]);

      const evald = await node.eval(context);
      const importedRules = evald.at(0) as Rules;
      const referencedRuleset = importedRules.at(0);
      expect(referencedRuleset).toBeDefined();
      // Optional means it's only considered if not found elsewhere
      // This is mainly for extend behavior
    });
  });

  describe('readonly behavior', () => {
    it('compose type is readonly by default', async () => {
      const composedPath = resolve(process.cwd(), 'composed.jess');
      context.sourceTrees.set(composedPath, rules([
        vardecl({ name: 'composedVar', value: any('initial') })
      ]));

      const node = rules([
        style({
          path: quoted(any('composed.jess'))
        }, {
          type: 'compose',
          namespace: '*'
        }),
        vardecl({ name: 'composedVar', value: any('modified') })
      ]);

      // Should throw because we're trying to shadow a readonly variable at the same level
      await expect(async () => {
        await node.eval(context);
      }).rejects.toThrowError('"composedVar" is readonly');
    });

    it('import type is NOT readonly by default', async () => {
      context.sourceTrees.set('imported.jess', rules([
        vardecl({ name: 'importedVar', value: any('initial') })
      ]));

      const node = rules([
        style({
          path: quoted(any('imported.jess'))
        }, {
          type: 'import'
        }),
        vardecl({ name: 'importedVar', value: any('modified') })
      ]);

      const evald = await node.eval(context);
      const importedRules = evald.at(0) as Rules;
      const varDecl = getVarWithContext(context, evald, 'importedVar');

      // Should have modified value because it's not readonly
      expect(varDecl).toBeDefined();
      // The variable lookup should return the local variable (index 1) which wins over the imported variable (index 0)
      // because local variables in the current Rules are treated as having the highest index (Number.MAX_SAFE_INTEGER)
      expect(`${varDecl}`).toBe('$importedVar: modified');
    });

    it.skip('readonly can be overridden for compose', async () => {
      // Skipped: There may not be a syntactic way to set @-compose to readonly: false
      const composedPath = resolve(process.cwd(), 'composed.jess');
      context.sourceTrees.set(composedPath, rules([
        vardecl({ name: 'composedVar', value: any('initial') })
      ]));

      const node = rules([
        style({
          path: quoted(any('composed.jess'))
        }, {
          type: 'compose',
          namespace: '*',
          importOptions: { readonly: false }
        }),
        vardecl({ name: 'composedVar', value: any('modified') })
      ]);

      const evald = await node.eval(context);
      const varDecl = getVarWithContext(context, evald, 'composedVar');

      // Should have modified value because readonly was overridden
      expect(`${varDecl}`).toBe('$composedVar: modified');
    });

    it('readonly can be set for import', async () => {
      const importedPath = resolve(process.cwd(), 'imported.jess');
      context.sourceTrees.set(importedPath, rules([
        vardecl({ name: 'importedVar', value: any('initial') })
      ]));

      const node = rules([
        style({
          path: quoted(any('imported.jess'))
        }, {
          type: 'import',
          importOptions: { readonly: true }
        }),
        vardecl({ name: 'importedVar', value: any('modified') })
      ]);

      // Should throw because we're trying to shadow a readonly variable at the same level
      await expect(async () => {
        await node.eval(context);
      }).rejects.toThrowError('"importedVar" is readonly');
    });
  });

  describe('with values', () => {
    it('can inject variables with "with" type', async () => {
      const libraryPath = resolve(process.cwd(), 'library.jess');
      context.sourceTrees.set(libraryPath, rules([
        ruleset({
          selector: sellist([sel([el('.box')])]),
          rules: rules([
            decl({ name: any('color'), value: ref('primaryColor', { type: 'variable' }) })
          ])
        })
      ]));

      const node = rules([
        style({
          path: quoted(any('library.jess')),
          with: {
            node: rules([
              vardecl({ name: 'primaryColor', value: any('purple') })
            ]),
            type: 'with'
          }
        }, {
          type: 'compose',
          namespace: '*'
        })
      ]);

      const evald = await node.eval(context);
      const composedRules = evald.at(0) as Rules;

      // Test 1: Verify injected variables are accessible
      const injectedVar = getVarWithContext(context, composedRules, 'primaryColor');
      expect(injectedVar).toBeDefined();
      // The variable declaration exists, which means the injection worked
      // We can verify the value by evaluating the variable's value property
      const injectedVarValueNode = injectedVar!.value.value;
      const injectedVarValue = await injectedVarValueNode.eval(context);
      expect(`${injectedVarValue}`).toBe('purple');

      // Test 2: Verify computed values based on injected variables are correct
      // Find the ruleset and its declaration
      const foundRuleset = Array.from(composedRules.value).find(
        node => isNode(node, 'Ruleset')
      );
      expect(foundRuleset).toBeDefined();
      const foundDecl = (foundRuleset as any).value.rules.at(0);
      expect(foundDecl).toBeDefined();
      const resolved = await foundDecl.eval(context);
      expect(`${resolved}`).toBe('color: purple');
    });

    it('can inject variables with "set" type', async () => {
      const libraryPath = resolve(process.cwd(), 'library.jess');
      context.sourceTrees.set(libraryPath, rules([
        ruleset({
          selector: sellist([sel([el('.box')])]),
          rules: rules([
            decl({ name: any('color'), value: ref('primaryColor', { type: 'variable' }) })
          ])
        })
      ]));

      const node = rules([
        style({
          path: quoted(any('library.jess')),
          with: {
            node: rules([
              vardecl({ name: 'primaryColor', value: any('orange') })
            ]),
            type: 'set'
          }
        }, {
          type: 'compose',
          namespace: '*'
        })
      ]);

      const evald = await node.eval(context);
      const composedRules = evald.at(0) as Rules;

      // Test 1: Verify injected variables are accessible
      const injectedVar = getVarWithContext(context, composedRules, 'primaryColor');
      expect(injectedVar).toBeDefined();
      // The variable declaration exists, which means the injection worked
      // We can verify the value by evaluating the variable's value property
      const injectedVarValueNode = injectedVar!.value.value;
      const injectedVarValue = await injectedVarValueNode.eval(context);
      expect(`${injectedVarValue}`).toBe('orange');

      // Test 2: Verify computed values based on injected variables are correct
      // Find the ruleset and its declaration
      const foundRuleset = Array.from(composedRules.value).find(
        node => isNode(node, 'Ruleset')
      );
      expect(foundRuleset).toBeDefined();
      const foundDecl = (foundRuleset as any).value.rules.at(0);
      expect(foundDecl).toBeDefined();
      const resolved = await foundDecl.eval(context);
      expect(`${resolved}`).toBe('color: orange');
    });

    it('updates computed variables with "with" type - scope lookup', async () => {
      // Test that when we inject a variable, dependent variables are updated
      // This tests scope-based lookup ($var)
      const libraryPath = resolve(process.cwd(), 'library.jess');
      context.sourceTrees.set(libraryPath, rules([
        vardecl({ name: 'baseColor', value: any('red') }),
        vardecl({ name: 'derivedColor', value: ref('baseColor', { type: 'variable' }) })
      ]));

      const node = rules([
        style({
          path: quoted(any('library.jess')),
          with: {
            node: rules([
              vardecl({ name: 'baseColor', value: any('blue') })
            ]),
            type: 'with'
          }
        }, {
          type: 'compose',
          namespace: '*'
        })
      ]);

      const evald = await node.eval(context);
      const composedRules = evald.at(0) as Rules;

      // Verify baseColor has the injected value
      const baseColor = getVarWithContext(context, composedRules, 'baseColor');
      expect(baseColor).toBeDefined();
      const baseColorValue = await baseColor!.value.value.eval(context);
      expect(`${baseColorValue}`).toBe('blue');

      // Verify derivedColor reflects the injected value (scope lookup)
      const derivedColor = getVarWithContext(context, composedRules, 'derivedColor');
      expect(derivedColor).toBeDefined();
      const derivedColorValue = await derivedColor!.value.value.eval(context);
      expect(`${derivedColorValue}`).toBe('blue');
    });

    it('updates computed variables with "with" type - linear lookup', async () => {
      // Test that when we inject a variable, dependent variables are updated
      // This tests linear lookup ($^var)
      const libraryPath = resolve(process.cwd(), 'library.jess');
      context.sourceTrees.set(libraryPath, rules([
        vardecl({ name: 'baseColor', value: any('red') }),
        vardecl({ name: 'derivedColor', value: ref('baseColor', { type: 'variable', resolution: 'linear' }) })
      ]));

      const node = rules([
        style({
          path: quoted(any('library.jess')),
          with: {
            node: rules([
              vardecl({ name: 'baseColor', value: any('green') })
            ]),
            type: 'with'
          }
        }, {
          type: 'compose',
          namespace: '*'
        })
      ]);

      const evald = await node.eval(context);
      const composedRules = evald.at(0) as Rules;

      // Verify baseColor has the injected value
      const baseColor = getVarWithContext(context, composedRules, 'baseColor');
      expect(baseColor).toBeDefined();
      const baseColorValue = await baseColor!.value.value.eval(context);
      expect(`${baseColorValue}`).toBe('green');

      // Verify derivedColor reflects the injected value (linear lookup)
      const derivedColor = getVarWithContext(context, composedRules, 'derivedColor');
      expect(derivedColor).toBeDefined();
      const derivedColorValue = await derivedColor!.value.value.eval(context);
      expect(`${derivedColorValue}`).toBe('green');
    });

    it('updates computed variables with "set" type - scope lookup', async () => {
      // Test that when we inject a variable with "set", dependent variables are updated
      // This tests scope-based lookup ($var)
      const libraryPath = resolve(process.cwd(), 'library.jess');
      context.sourceTrees.set(libraryPath, rules([
        vardecl({ name: 'baseColor', value: any('red') }),
        vardecl({ name: 'derivedColor', value: ref('baseColor', { type: 'variable' }) })
      ]));

      const node = rules([
        style({
          path: quoted(any('library.jess')),
          with: {
            node: rules([
              vardecl({ name: 'baseColor', value: any('yellow') })
            ]),
            type: 'set'
          }
        }, {
          type: 'compose',
          namespace: '*'
        })
      ]);

      const evald = await node.eval(context);
      const composedRules = evald.at(0) as Rules;

      // Verify baseColor has the injected value
      const baseColor = getVarWithContext(context, composedRules, 'baseColor');
      expect(baseColor).toBeDefined();
      const baseColorValue = await baseColor!.value.value.eval(context);
      expect(`${baseColorValue}`).toBe('yellow');

      // Verify derivedColor reflects the injected value (scope lookup)
      const derivedColor = getVarWithContext(context, composedRules, 'derivedColor');
      expect(derivedColor).toBeDefined();
      const derivedColorValue = await derivedColor!.value.value.eval(context);
      expect(`${derivedColorValue}`).toBe('yellow');
    });

    it('updates computed variables with "set" type - linear lookup', async () => {
      // Test that when we inject a variable with "set", dependent variables are updated
      // This tests linear lookup ($^var)
      const libraryPath = resolve(process.cwd(), 'library.jess');
      context.sourceTrees.set(libraryPath, rules([
        vardecl({ name: 'baseColor', value: any('red') }),
        vardecl({ name: 'derivedColor', value: ref('baseColor', { type: 'variable', resolution: 'linear' }) })
      ]));

      const node = rules([
        style({
          path: quoted(any('library.jess')),
          with: {
            node: rules([
              vardecl({ name: 'baseColor', value: any('cyan') })
            ]),
            type: 'set'
          }
        }, {
          type: 'compose',
          namespace: '*'
        })
      ]);

      const evald = await node.eval(context);
      const composedRules = evald.at(0) as Rules;

      // When 'set' is used, structure is flattened:
      // [new injected variables (not found), ...all nodes from imported rules (with replacements)]
      // All variables are in the same Rules scope

      // Verify baseColor was injected (should be the injected one, not the original)
      const baseColor = getVarWithContext(context, composedRules, 'baseColor');
      expect(baseColor).toBeDefined();
      const baseColorValue = await baseColor!.value.value.eval(context);
      expect(`${baseColorValue}`).toBe('cyan');

      // Verify derivedColor reflects the injected value (linear lookup)
      // derivedColor is in the composed rules (flattened structure)
      // It should be able to find the injected baseColor in the same scope
      const derivedColor = getVarWithContext(context, composedRules, 'derivedColor');
      expect(derivedColor).toBeDefined();
      // The value should already be evaluated during the import evaluation
      // and should have used the injected baseColor
      const derivedColorValue = await derivedColor!.value.value.eval(context);
      expect(`${derivedColorValue}`).toBe('cyan');
    });

    it('throws if "set" is used more than once', async () => {
      const libraryPath = resolve(process.cwd(), 'library.jess');
      context.sourceTrees.set(libraryPath, rules([
        vardecl({ name: 'var', value: any('value') })
      ]));

      // First use
      const node1 = rules([
        style({
          path: quoted(any('library.jess')),
          with: {
            node: rules([
              vardecl({ name: 'var', value: any('first') })
            ]),
            type: 'set'
          }
        }, {
          type: 'compose',
          namespace: '*'
        })
      ]);
      await node1.eval(context);

      // Second use - should throw
      const node2 = rules([
        style({
          path: quoted(any('library.jess')),
          with: {
            node: rules([
              vardecl({ name: 'var', value: any('second') })
            ]),
            type: 'set'
          }
        }, {
          type: 'compose',
          namespace: '*'
        })
      ]);

      await expect(async () => {
        await node2.eval(context);
      }).rejects.toThrow('Cannot configure a stylesheet more than once');
    });
  });

  describe('multiple imports', () => {
    it('import type can be imported multiple times', async () => {
      context.sourceTrees.set('imported.jess', rules([
        ruleset({
          selector: sellist([sel([el('.imported')])]),
          rules: rules([
            decl({ name: any('color'), value: any('red') })
          ])
        })
      ]));

      const node = rules([
        style({
          path: quoted(any('imported.jess'))
        }, {
          type: 'import'
        }),
        style({
          path: quoted(any('imported.jess'))
        }, {
          type: 'import',
          importOptions: { multiple: true }
        })
      ]);

      const evald = await node.eval(context);
      // Both imports should be present
      expect(evald.value.length).toBe(2);
    });
  });
});
