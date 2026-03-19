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
  list,
  quoted,
  Interpolated,
  INTERPOLATION_PLACEHOLDER,
  type Rules,
  Node
} from '../index.js';
import { isNode } from '../util/is-node.js';
import { N } from '../node-type.js';
import { Context } from '../../context.js';
import type { FindOptions } from '../util/registry-utils.js';
import { resolve } from 'node:path';
import { createTestContext } from './import-style-test-helpers.js';

let context: Context;

function getVarWithContext(context: Context, n: Rules, key: string, opts: FindOptions = {}) {
  context.rulesContext = n;
  opts.context ??= context;
  opts.searchParents = true;
  return n.find('declaration', key, 'VarDeclaration', opts);
}

function getMixinWithContext(context: Context, n: Rules, key: string, opts: FindOptions = {}) {
  context.rulesContext = n;
  opts.context ??= context;
  opts.searchParents = true;
  return n.find('mixin', key, 'Mixin', opts);
}

function getRulesetWithContext(context: Context, n: Rules, keys: string | string[], opts: FindOptions = {}) {
  context.rulesContext = n;
  opts.context ??= context;
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
      const importedDecl = (importedRuleset as any).rules.at(0);
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
      const composedDecl = (composedRuleset as any).rules.at(0);
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
      const parentDecl = (parentRuleset as any).rules.at(0);
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
      const parentDecl = (parentRuleset as any).rules.at(0);
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
      const mixinCall = (parentRuleset as any).rules.at(0);
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
      const mixinCall = (parentRuleset as any).rules.at(0);
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
      const mixinCall1 = (parentRuleset1 as any).rules.at(0);
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

    it('non-mutable import makes rulesets private', async () => {
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
          importOptions: { mutable: false }
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

  describe('forward behavior', () => {
    it('forwarded members are not visible locally, but are visible downstream', async () => {
      const forwardedPath = resolve(process.cwd(), 'forwarded.jess');
      context.sourceTrees.set(forwardedPath, rules([
        vardecl({ name: 'forwardedVar', value: any('ok') })
      ]));

      const forwarderPath = resolve(process.cwd(), 'forwarder.jess');
      context.sourceTrees.set(forwarderPath, rules([
        style(
          { path: quoted(any('forwarded.jess')) },
          { type: 'compose', namespace: '*', importOptions: { forward: true } }
        )
        // Nothing else in this module.
      ]));

      // Evaluate forwarder module (as if compiling that file directly)
      const evaldForwarder = await rules([
        style({ path: quoted(any('forwarder.jess')) }, { type: 'import' })
      ]).eval(context);

      // Locally (inside the forwarder module), forwarded members should NOT be visible.
      const forwarderRules = evaldForwarder.at(0) as Rules;
      const localLookup = getVarWithContext(context, forwarderRules, 'forwardedVar');
      expect(localLookup).toBeUndefined();

      // Downstream (a consumer importing the forwarder), forwarded members SHOULD be visible.
      const consumer = rules([
        style({ path: quoted(any('forwarder.jess')) }, { type: 'import' })
      ]);
      const evaldConsumer = await consumer.eval(context);
      const downstreamLookup = getVarWithContext(context, evaldConsumer, 'forwardedVar');
      expect(downstreamLookup).toBeDefined();
      expect(`${downstreamLookup}`).toBe('$forwardedVar: ok');
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
            ]) as any,
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
      const injectedVarValueNode = (injectedVar as any).value;
      const injectedVarValue = await injectedVarValueNode.eval(context);
      expect(`${injectedVarValue}`).toBe('purple');

      // Test 2: Verify computed values based on injected variables are correct
      // Find the ruleset and its declaration
      const foundRuleset = Array.from(composedRules.value).find(
        node => isNode(node, N.Ruleset)
      );
      expect(foundRuleset).toBeDefined();
      const foundDecl = (foundRuleset as any).rules.at(0);
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
            ]) as any,
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
      const injectedVarValueNode = (injectedVar as any).value;
      const injectedVarValue = await injectedVarValueNode.eval(context);
      expect(`${injectedVarValue}`).toBe('orange');

      // Test 2: Verify computed values based on injected variables are correct
      // Find the ruleset and its declaration
      const foundRuleset = Array.from(composedRules.value).find(
        node => isNode(node, N.Ruleset)
      );
      expect(foundRuleset).toBeDefined();
      const foundDecl = (foundRuleset as any).rules.at(0);
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
            ]) as any,
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
      const baseColorValue = await (baseColor as any).value.eval(context);
      expect(`${baseColorValue}`).toBe('blue');

      // Verify derivedColor reflects the injected value (scope lookup)
      const derivedColor = getVarWithContext(context, composedRules, 'derivedColor');
      expect(derivedColor).toBeDefined();
      const derivedColorValue = await (derivedColor as any).value.eval(context);
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
            ]) as any,
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
      const baseColorValue = await (baseColor as any).value.eval(context);
      expect(`${baseColorValue}`).toBe('green');

      // Verify derivedColor reflects the injected value (linear lookup)
      const derivedColor = getVarWithContext(context, composedRules, 'derivedColor');
      expect(derivedColor).toBeDefined();
      const derivedColorValue = await (derivedColor as any).value.eval(context);
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
            ]) as any,
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
      const baseColorValue = await (baseColor as any).value.eval(context);
      expect(`${baseColorValue}`).toBe('yellow');

      // Verify derivedColor reflects the injected value (scope lookup)
      const derivedColor = getVarWithContext(context, composedRules, 'derivedColor');
      expect(derivedColor).toBeDefined();
      const derivedColorValue = await (derivedColor as any).value.eval(context);
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
            ]) as any,
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
      const baseColorValue = await (baseColor as any).value.eval(context);
      expect(`${baseColorValue}`).toBe('cyan');

      // Verify derivedColor reflects the injected value (linear lookup)
      // derivedColor is in the composed rules (flattened structure)
      // It should be able to find the injected baseColor in the same scope
      const derivedColor = getVarWithContext(context, composedRules, 'derivedColor');
      expect(derivedColor).toBeDefined();
      // The value should already be evaluated during the import evaluation
      // and should have used the injected baseColor
      const derivedColorValue = await (derivedColor as any).value.eval(context);
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
            ]) as any,
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
            ]) as any,
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

  describe('less import fixture regressions', () => {
    it('import-inline: inline import with media postlude inlines source content', async () => {
      const inlinePath = resolve(process.cwd(), 'inline-source.css');
      const inlineContext = new Context({}, [{
        name: 'inline-plugin',
        supportedExtensions: ['.css'],
        resolve(filePath: string | string[]) {
          const paths = Array.isArray(filePath) ? filePath : [filePath];
          return paths.map(p => (p.endsWith('.css') ? p : `${p}.css`));
        },
        locate(pathCandidates: string[], currentDir: string) {
          for (const candidate of pathCandidates) {
            const abs = candidate.startsWith('/') ? candidate : resolve(currentDir, candidate);
            if (abs === inlinePath) {
              return abs;
            }
          }
          return null;
        },
        async getSource() {
          return '#css { color: yellow; }\n';
        }
      }]);
      inlineContext.treeContext = {
        file: { name: 'entry.less', path: process.cwd(), fullPath: resolve(process.cwd(), 'entry.less') }
      } as any;

      const node = rules([
        style({ path: quoted(any('inline-source.css')) }, {
          type: 'import',
          importOptions: {
            inline: true,
            postlude: any('(min-width: 600px)')
          }
        })
      ]);
      const evald = await node.eval(inlineContext);
      expect(evald.toString({ context: inlineContext })).toContain('@media (min-width: 600px)');
      expect(evald.toString({ context: inlineContext })).toContain('#css { color: yellow; }');
    });

    it('import-inline: supports/layer postludes wrap inline source in order', async () => {
      const inlinePath = resolve(process.cwd(), 'inline-postlude.css');
      const inlineContext = new Context({}, [{
        name: 'inline-plugin',
        supportedExtensions: ['.css'],
        resolve(filePath: string | string[]) {
          const paths = Array.isArray(filePath) ? filePath : [filePath];
          return paths.map(p => (p.endsWith('.css') ? p : `${p}.css`));
        },
        locate(pathCandidates: string[], currentDir: string) {
          for (const candidate of pathCandidates) {
            const abs = candidate.startsWith('/') ? candidate : resolve(currentDir, candidate);
            if (abs === inlinePath) {
              return abs;
            }
          }
          return null;
        },
        async getSource() {
          return '#css { color: yellow; }\n';
        }
      }]);
      inlineContext.treeContext = {
        file: { name: 'entry.less', path: process.cwd(), fullPath: resolve(process.cwd(), 'entry.less') }
      } as any;

      const postlude = list([
        call({ name: 'layer', args: list([any('theme')]) }),
        call({ name: 'supports', args: list([any('(display: grid)')]) }),
        any('screen and (min-width: 600px)')
      ], { sep: ' ' as any });

      const node = rules([
        style({ path: quoted(any('inline-postlude.css')) }, {
          type: 'import',
          importOptions: {
            inline: true,
            postlude
          }
        })
      ]);

      const css = (await node.eval(inlineContext)).toString({ context: inlineContext });
      expect(css).toContain('@layer theme');
      expect(css).toContain('@supports (display: grid)');
      expect(css).toContain('@media screen and (min-width: 600px)');
      expect(css).toContain('#css { color: yellow; }');
    });

    it('import-interpolation: resolves vars from later imports on retry', async () => {
      const interpolationImportPath = resolve(process.cwd(), 'import/import-interpolation.jess');
      const interpolationVarsPath = resolve(process.cwd(), 'import/interpolation-vars.jess');

      context.sourceTrees.set(interpolationImportPath, rules([
        vardecl({ name: 'interpolationResolved', value: any('ok') })
      ]));
      context.sourceTrees.set(interpolationVarsPath, rules([
        vardecl({ name: 'segmentA', value: any('in') }),
        vardecl({ name: 'segmentB', value: any('terpolation') })
      ]));

      const interpolatedPath = new Interpolated({
        source: `import/import-${INTERPOLATION_PLACEHOLDER}${INTERPOLATION_PLACEHOLDER}.jess`,
        replacements: [ref('segmentA', { type: 'variable' }), ref('segmentB', { type: 'variable' })]
      }, { role: 'ident' });

      const node = rules([
        style({ path: quoted(interpolatedPath) }, { type: 'import', importOptions: { optional: false } }),
        style({ path: quoted(any('import/interpolation-vars.jess')) }, { type: 'import' })
      ]);

      const evald = await node.eval(context);
      const resolvedFromInterpolatedImport = getVarWithContext(context, evald, 'interpolationResolved');
      expect(resolvedFromInterpolatedImport).toBeDefined();
      expect(`${resolvedFromInterpolatedImport}`).toBe('$interpolationResolved: ok');
    });

    it('import-module: context can resolve bare module-like specifiers', async () => {
      const moduleContext = new Context();
      moduleContext.treeContext = {
        file: { name: 'entry.less', path: process.cwd(), fullPath: resolve(process.cwd(), 'entry.less') }
      } as any;
      const result = await (moduleContext as any)._getPath('lodash-es');
      expect(typeof result.resolvedPath).toBe('string');
      expect(result.resolvedPath.length).toBeGreaterThan(0);
    });

    it('import-once: default once semantics de-dupe repeated imports', async () => {
      const oncePath = resolve(process.cwd(), 'once.jess');
      context.sourceTrees.set(oncePath, rules([
        ruleset({
          selector: sellist([sel([el('.once')])]),
          rules: rules([decl({ name: any('color'), value: any('red') })])
        })
      ]));

      const node = rules([
        style({ path: quoted(any('once.jess')) }, { type: 'import' }),
        style({ path: quoted(any('once.jess')) }, { type: 'import' })
      ]);
      const evald = await node.eval(context);
      expect(evald.toString().split('.once').length - 1).toBe(1);
    });

    it('import-reference-issues: reference imports are optional visibility', async () => {
      const referencedPath = resolve(process.cwd(), 'reference-issues.jess');
      context.sourceTrees.set(referencedPath, rules([
        ruleset({
          selector: sellist([sel([el('.hidden')])]),
          rules: rules([decl({ name: any('color'), value: any('red') })])
        })
      ]));
      const node = rules([
        style({ path: quoted(any('reference-issues.jess')) }, { type: 'import', importOptions: { reference: true } })
      ]);
      const evald = await node.eval(context);
      const imported = evald.at(0) as Rules;
      expect(imported.options.rulesVisibility?.Ruleset).toBe('optional');
    });

    it('import-reference: reference imports remain discoverable for lookups', async () => {
      const referencedPath = resolve(process.cwd(), 'reference.jess');
      context.sourceTrees.set(referencedPath, rules([
        vardecl({ name: 'fromRef', value: any('42') })
      ]));
      const node = rules([
        style({ path: quoted(any('reference.jess')) }, { type: 'import', importOptions: { reference: true } }),
        decl({ name: any('value'), value: ref('fromRef', { type: 'variable' }) })
      ]);
      const evald = await node.eval(context);
      const declaration = evald.at(1) as any;
      const resolved = await declaration.eval(context);
      expect(`${resolved}`).toBe('value: 42');
    });

    it('import-remote: mapped remote package paths can be resolved as module-like imports', async () => {
      const remoteContext = new Context({}, [{
        name: 'remote-map',
        supportedExtensions: ['.less'],
        resolve(filePath: string | string[], currentDir: string, searchPaths: string[]) {
          const paths = Array.isArray(filePath) ? filePath : [filePath];
          const mapped = paths.map((candidate) => {
            const m = candidate.match(/^https?:\/\/cdn\.jsdelivr\.net\/npm\/([^?#]+)(?:[?#].*)?$/i);
            return m?.[1] ?? candidate;
          });
          void currentDir;
          void searchPaths;
          return mapped;
        },
        locate() {
          return null;
        }
      }]);
      remoteContext.treeContext = {
        file: { name: 'entry.less', path: process.cwd(), fullPath: resolve(process.cwd(), 'entry.less') }
      } as any;
      const result = await (remoteContext as any)._getPath('https://cdn.jsdelivr.net/npm/lodash-es/lodash.js');
      expect(typeof result.resolvedPath).toBe('string');
      expect(result.resolvedPath.length).toBeGreaterThan(0);
    });

    it('import.less: optional missing imports do not throw and produce empty rules', async () => {
      const node = rules([
        style({ path: quoted(any('missing-file.jess')) }, { type: 'import', importOptions: { optional: true } })
      ]);
      const evald = await node.eval(context);
      expect(evald.value.length).toBe(1);
      const imported = evald.at(0) as Rules;
      expect(imported.value.length).toBe(0);
    });
  });

  describe('reference/multiple dedupe matrix', () => {
    const countSelector = (css: string, selector: string) => css.split(selector).length - 1;

    it('import once:false renders repeated imports', async () => {
      context.sourceTrees.set('repeat.jess', rules([
        ruleset({
          selector: sellist([sel([el('.repeat')])]),
          rules: rules([decl({ name: any('color'), value: any('red') })])
        })
      ]));
      const node = rules([
        style({ path: quoted(any('repeat.jess')) }, { type: 'import', importOptions: { once: false } }),
        style({ path: quoted(any('repeat.jess')) }, { type: 'import', importOptions: { once: false } })
      ]);
      const evald = await node.eval(context);
      expect(countSelector(evald.toString(), '.repeat')).toBe(2);
    });

    it('plain import followed by reference import renders once', async () => {
      context.sourceTrees.set('mix-order.jess', rules([
        ruleset({
          selector: sellist([sel([el('.mix-order')])]),
          rules: rules([decl({ name: any('color'), value: any('red') })])
        })
      ]));
      const node = rules([
        style({ path: quoted(any('mix-order.jess')) }, { type: 'import' }),
        style(
          { path: quoted(any('mix-order.jess')) },
          { type: 'import', importOptions: { reference: true } }
        )
      ]);
      const evald = await node.eval(context);
      expect(countSelector(evald.toString(), '.mix-order')).toBe(1);
    });

    it('reference import followed by plain import stays suppressed without multiple', async () => {
      context.sourceTrees.set('mix-order-rev.jess', rules([
        ruleset({
          selector: sellist([sel([el('.mix-order-rev')])]),
          rules: rules([decl({ name: any('color'), value: any('red') })])
        })
      ]));
      const node = rules([
        style(
          { path: quoted(any('mix-order-rev.jess')) },
          { type: 'import', importOptions: { reference: true } }
        ),
        style({ path: quoted(any('mix-order-rev.jess')) }, { type: 'import' })
      ]);
      const evald = await node.eval(context);
      expect(countSelector(evald.toString(), '.mix-order-rev')).toBe(0);
    });

    it('compose multiple:true renders repeated modules', async () => {
      context.sourceTrees.set('compose-repeat.jess', rules([
        ruleset({
          selector: sellist([sel([el('.compose-repeat')])]),
          rules: rules([decl({ name: any('color'), value: any('red') })])
        })
      ]));
      const node = rules([
        style(
          { path: quoted(any('compose-repeat.jess')) },
          { type: 'compose', namespace: '*', importOptions: { multiple: true } }
        ),
        style(
          { path: quoted(any('compose-repeat.jess')) },
          { type: 'compose', namespace: '*', importOptions: { multiple: true } }
        )
      ]);
      const evald = await node.eval(context);
      expect(countSelector(evald.toString(), '.compose-repeat')).toBe(2);
    });
  });

  describe('compose caching', () => {
    it('caches evaluated compose modules and de-dupes output unless multiple=true', async () => {
      context.sourceTrees.set('library-dedupe.jess', rules([
        ruleset({
          selector: sellist([sel([el('.imported')])]),
          rules: rules([
            decl({ name: any('color'), value: any('red') })
          ])
        })
      ]));

      const node = rules([
        style({ path: quoted(any('library-dedupe.jess')) }, { type: 'compose', namespace: '*' }),
        style({ path: quoted(any('library-dedupe.jess')) }, { type: 'compose', namespace: '*' })
      ]);

      const evald = await node.eval(context);
      const css = evald.toString();
      // Should only render `.imported` once (second compose is reference mode by default).
      expect(css.split('.imported').length - 1).toBe(1);
    });

    it('still allows per-import visibility differences via shallow clone', async () => {
      context.sourceTrees.set('library-vis.jess', rules([
        ruleset({
          selector: sellist([sel([el('.imported')])]),
          rules: rules([
            decl({ name: any('color'), value: any('red') })
          ])
        })
      ]));

      const node = rules([
        style(
          { path: quoted(any('library-vis.jess')) },
          { type: 'compose', namespace: '*', importOptions: { mutable: true } }
        ),
        style(
          { path: quoted(any('library-vis.jess')) },
          { type: 'compose', namespace: '*', importOptions: { mutable: false, multiple: true } }
        )
      ]);

      const evald = await node.eval(context);
      expect(evald.value.length).toBe(2);
      const first = evald.at(0) as Rules;
      const second = evald.at(1) as Rules;
      expect(first.options.rulesVisibility.Ruleset).toBe('public');
      expect(second.options.rulesVisibility.Ruleset).toBe('private');
    });
  });
});
