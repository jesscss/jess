import { describe, it, expect, beforeEach, beforeAll, vi } from 'vitest';
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
  url,
  Interpolated,
  INTERPOLATION_PLACEHOLDER,
  type Rules,
  Node,
  Ruleset
} from '../index.js';
import { isNode } from '../util/is-node.js';
import { N } from '../node-type.js';
import { Context } from '../../context.js';
import type { FindOptions } from '../util/registry-utils.js';
import { resolve } from 'node:path';
import { createTestContext } from './import-style-test-helpers.js';
import { getParent } from '../util/field-helpers.js';
import { addEdge } from '../util/cursor.js';

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

function asRulesContext(context: Context, rules: Rules): Context {
  return {
    ...context,
    renderKey: rules.renderKey,
    rulesContext: rules
  } as Context;
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
      const importedRules = evald.at(1, context) as Rules;
      const importedRuleset = importedRules.at(0, context);
      const importedCtx = asRulesContext(context, (importedRuleset as any).rules);

      // The imported ruleset should be able to reference the parent variable
      // The declaration should already be evaluated as part of the ruleset evaluation
      const importedDecl = (importedRuleset as any).rules.at(0, importedCtx);
      expect(importedDecl.toTrimmedString({ context: importedCtx })).toBe('color: red');
    });

    it('import placements can reuse canonical imported rulesets while resolving different parent vars', async () => {
      const importedPath = resolve(process.cwd(), 'imported-shared-ambient.jess');
      const sourceRuleset = ruleset({
        selector: sellist([sel([el('.imported')])]),
        rules: rules([
          decl({ name: any('color'), value: ref('parentVar', { type: 'variable' }) })
        ])
      });
      const sourceBody = sourceRuleset.get('rules');
      const sourceDecl = sourceBody.at(0, context);
      const sourceTree = rules([sourceRuleset]);

      const evaluateImport = async (color: string) => {
        const localContext = createTestContext();
        localContext.sourceTrees.set(importedPath, sourceTree);
        const entry = rules([
          vardecl({ name: 'parentVar', value: any(color) }),
          style({ path: quoted(any('imported-shared-ambient.jess')) }, { type: 'import' })
        ]);
        const evald = await entry.eval(localContext);
        return {
          localContext,
          evald,
          importedRules: evald.at(1, localContext) as Rules,
          importedRuleset: (evald.at(1, localContext) as Rules).at(0, localContext) as Ruleset
        };
      };

      const red = await evaluateImport('red');
      const blue = await evaluateImport('blue');

      const redDecl = (red.importedRuleset as any).rules.at(0, red.localContext);
      const blueDecl = (blue.importedRuleset as any).rules.at(0, blue.localContext);

      expect(red.importedRuleset).not.toBe(blue.importedRuleset);
      expect(red.importedRuleset.sourceNode).toBe(sourceRuleset);
      expect(blue.importedRuleset.sourceNode).toBe(sourceRuleset);
      expect((red.importedRuleset as any).rules.sourceNode).toBe(sourceBody);
      expect((blue.importedRuleset as any).rules.sourceNode).toBe(sourceBody);
      expect(redDecl.sourceNode).toBe(sourceDecl);
      expect(blueDecl.sourceNode).toBe(sourceDecl);
      expect(red.evald.render(red.localContext)).toContain('color: red');
      expect(blue.evald.render(blue.localContext)).toContain('color: blue');
      expect(sourceRuleset.parent).toBe(sourceTree);
      expect(sourceBody.parent).toBe(sourceRuleset);
      expect(sourceDecl.parent).toBe(sourceBody);
    });

    it('import returned trees already preserve descendant parent chains to the returned Rules', async () => {
      const importedPath = resolve(process.cwd(), 'imported-parent-chain.jess');
      context.sourceTrees.set(importedPath, rules([
        ruleset({
          selector: sellist([sel([el('.imported')])]),
          rules: rules([
            decl({ name: any('color'), value: any('red') })
          ])
        })
      ]));

      const node = rules([
        style({
          path: quoted(any('imported-parent-chain.jess'))
        }, {
          type: 'import'
        })
      ]);

      const evald = await node.eval(context);
      const importedRules = evald.at(0, context) as Rules;
      const importedRuleset = importedRules.at(0, context);
      const importedDecl = (importedRuleset as any).rules.at(0, context);
      const rootCtx = asRulesContext(context, evald);
      const importedCtx = asRulesContext(context, importedRules);

      expect(getParent(importedRules, rootCtx)).toBe(evald);
      expect(getParent(importedRuleset, importedCtx)).toBe(importedRules);
      expect(getParent((importedRuleset as any).rules, importedCtx)).toBe(importedRuleset);
      expect(getParent(importedDecl, importedCtx)).toBe((importedRuleset as any).rules);
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
      const composedRules = evald.at(1, context) as Rules;
      const composedRuleset = composedRules.at(0, context);
      const composedCtx = asRulesContext(context, (composedRuleset as any).rules);

      // The composed ruleset should NOT be able to reference the parent variable
      // It should use the fallback value instead
      const composedDecl = (composedRuleset as any).rules.at(0, composedCtx);
      const resolved = await composedDecl.eval(composedCtx);
      expect(resolved.toTrimmedString({ context: composedCtx })).toBe('color: blue');
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
      const parentRuleset = evald.at(1, context);
      const parentCtx = asRulesContext(context, (parentRuleset as any).rules);
      const parentDecl = (parentRuleset as any).rules.at(0, parentCtx);
      const resolved = await parentDecl.eval(parentCtx);
      expect(resolved.toTrimmedString({ context: parentCtx })).toBe('color: green');
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
      const parentRuleset = evald.at(1, context);
      const parentCtx = asRulesContext(context, (parentRuleset as any).rules);
      const parentDecl = (parentRuleset as any).rules.at(0, parentCtx);
      const resolved = await parentDecl.eval(parentCtx);
      // Should use composedVar from the compose
      expect(resolved.toTrimmedString({ context: parentCtx })).toBe('color: purple');
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
      const parentRuleset = evald.at(1, context);
      const mixinCall = (parentRuleset as any).rules.at(0, context);
      const resolved = await mixinCall.eval(context);
      expect(resolved.toTrimmedString({ context })).toContainString('color: blue');
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
      const parentRuleset = evald.at(1, context);
      const mixinCall = (parentRuleset as any).rules.at(0, context);
      const resolved = await mixinCall.eval(context);
      expect(resolved.toTrimmedString({ context })).toContainString('color: yellow');
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
      const parentRuleset1 = evald1.at(1, context);
      const mixinCall1 = (parentRuleset1 as any).rules.at(0, context);
      const resolved1 = await mixinCall1.eval(context);
      expect(resolved1.toTrimmedString({ context })).toContainString('color: white');
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
      const importedRules = evald.at(0, context) as Rules;
      const importedRuleset = importedRules.at(0, context);
      expect(importedRuleset).toBeDefined();
      expect(importedRuleset.toTrimmedString({ context })).toContainString('.imported');
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
      const importedRules = evald.at(0, context) as Rules;
      // Ruleset should still exist but be private
      const protectedRuleset = importedRules.at(0, context);
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
      const importedRules = evald.at(0, context) as Rules;
      const referencedRuleset = importedRules.at(0, context);
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
      const importedRules = evald.at(0, context) as Rules;
      const varDecl = getVarWithContext(context, evald, 'importedVar');

      // Should have modified value because it's not readonly
      expect(varDecl).toBeDefined();
      // The variable lookup should return the local variable (index 1) which wins over the imported variable (index 0)
      // because local variables in the current Rules are treated as having the highest index (Number.MAX_SAFE_INTEGER)
      expect(varDecl.toTrimmedString({ context })).toBe('$importedVar: modified');
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
      expect(varDecl.toTrimmedString({ context })).toBe('$composedVar: modified');
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
    it.skip('forwarded members are not visible locally, but are visible downstream', async () => {
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
      const forwarderRules = evaldForwarder.at(0, context) as Rules;
      const localLookup = getVarWithContext(context, forwarderRules, 'forwardedVar');
      expect(localLookup).toBeUndefined();

      // Downstream (a consumer importing the forwarder), forwarded members SHOULD be visible.
      const consumer = rules([
        style({ path: quoted(any('forwarder.jess')) }, { type: 'import' })
      ]);
      const evaldConsumer = await consumer.eval(context);
      const consumerImport = evaldConsumer.at(0, context) as Rules;
      const consumerImportChildren = Array.from((consumerImport as any).value ?? []);
      const nestedForward = consumerImportChildren[0];
      const downstreamLookup = getVarWithContext(context, evaldConsumer, 'forwardedVar');
      context.rulesContext = evaldConsumer;
      const importLookupFromConsumerContext = consumerImport.find('declaration', 'forwardedVar', 'VarDeclaration', {
        context,
        searchParents: true
      });
      context.rulesContext = consumerImport;
      const importLookupFromImportContext = consumerImport.find('declaration', 'forwardedVar', 'VarDeclaration', {
        context,
        searchParents: true
      });
      expect(downstreamLookup).toBeDefined();
      expect(downstreamLookup.toTrimmedString({ context })).toBe('$forwardedVar: ok');
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
          withNode: rules([
            vardecl({ name: 'primaryColor', value: any('purple') })
          ]) as any,
          withType: 'with'
        }, {
          type: 'compose',
          namespace: '*'
        })
      ]);

      const evald = await node.eval(context);
      const composedRules = evald.at(0, context) as Rules;

      // Test 1: Verify injected variables are accessible
      const injectedVar = getVarWithContext(context, composedRules, 'primaryColor');
      expect(injectedVar).toBeDefined();
      // The variable declaration exists, which means the injection worked
      // We can verify the value by evaluating the variable's value property
      const injectedVarValueNode = (injectedVar as any).value;
      const injectedVarValue = await injectedVarValueNode.eval(context);
      expect(injectedVarValue.toTrimmedString({ context })).toBe('purple');

      // Test 2: Verify computed values based on injected variables are correct
      // Find the ruleset and its declaration
      const foundRuleset = Array.from(composedRules.value).find(
        node => isNode(node, N.Ruleset)
      );
      expect(foundRuleset).toBeDefined();
      const foundCtx = asRulesContext(context, (foundRuleset as any).rules);
      const foundDecl = (foundRuleset as any).rules.at(0, foundCtx);
      expect(foundDecl).toBeDefined();
      const resolved = await foundDecl.eval(foundCtx);
      expect(resolved.toTrimmedString({ context: foundCtx })).toBe('color: purple');
    });

    it('configured compose returned trees already preserve descendant parent chains to the returned Rules', async () => {
      const libraryPath = resolve(process.cwd(), 'library-parent-chain.jess');
      context.sourceTrees.set(libraryPath, rules([
        ruleset({
          selector: sellist([sel([el('.box')])]),
          rules: rules([
            decl({ name: any('color'), value: any('purple') })
          ])
        })
      ]));

      const node = rules([
        style({
          path: quoted(any('library-parent-chain.jess')),
          withNode: rules([
            vardecl({ name: 'primaryColor', value: any('purple') })
          ]) as any,
          withType: 'with'
        }, {
          type: 'compose',
          namespace: '*'
        })
      ]);

      const evald = await node.eval(context);
      const composedRules = evald.at(0, context) as Rules;
      const foundRuleset = Array.from(composedRules.value).find(
        node => isNode(node, N.Ruleset)
      );
      const foundDecl = (foundRuleset as any).rules.at(0, context);
      const composedCtx = asRulesContext(context, composedRules);

      expect(getParent(foundRuleset!, composedCtx)).toBe(composedRules);
      expect(getParent((foundRuleset as any).rules, composedCtx)).toBe(foundRuleset);
      expect(getParent(foundDecl, composedCtx)).toBe((foundRuleset as any).rules);
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
          withNode: rules([
            vardecl({ name: 'primaryColor', value: any('orange') })
          ]) as any,
          withType: 'set'
        }, {
          type: 'compose',
          namespace: '*'
        })
      ]);

      const evald = await node.eval(context);
      const composedRules = evald.at(0, context) as Rules;

      // Test 1: Verify injected variables are accessible
      const injectedVar = getVarWithContext(context, composedRules, 'primaryColor');
      expect(injectedVar).toBeDefined();
      // The variable declaration exists, which means the injection worked
      // We can verify the value by evaluating the variable's value property
      const injectedVarValueNode = (injectedVar as any).value;
      const injectedVarValue = await injectedVarValueNode.eval(context);
      expect(injectedVarValue.toTrimmedString({ context })).toBe('orange');

      // Test 2: Verify computed values based on injected variables are correct
      // Find the ruleset and its declaration
      const foundRuleset = Array.from(composedRules.value).find(
        node => isNode(node, N.Ruleset)
      );
      expect(foundRuleset).toBeDefined();
      const foundCtx = asRulesContext(context, (foundRuleset as any).rules);
      const foundDecl = (foundRuleset as any).rules.at(0, foundCtx);
      expect(foundDecl).toBeDefined();
      const resolved = await foundDecl.eval(foundCtx);
      expect(resolved.toTrimmedString({ context: foundCtx })).toBe('color: orange');
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
          withNode: rules([
            vardecl({ name: 'baseColor', value: any('blue') })
          ]) as any,
          withType: 'with'
        }, {
          type: 'compose',
          namespace: '*'
        })
      ]);

      const evald = await node.eval(context);
      const composedRules = evald.at(0, context) as Rules;

      // Verify baseColor has the injected value
      const baseColor = getVarWithContext(context, composedRules, 'baseColor');
      expect(baseColor).toBeDefined();
      const baseColorValue = await (baseColor as any).value.eval(context);
      expect(baseColorValue.toTrimmedString({ context })).toBe('blue');

      // Verify derivedColor reflects the injected value (scope lookup)
      const derivedColor = getVarWithContext(context, composedRules, 'derivedColor');
      expect(derivedColor).toBeDefined();
      const derivedColorValue = await (derivedColor as any).value.eval(context);
      expect(derivedColorValue.toTrimmedString({ context })).toBe('blue');
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
          withNode: rules([
            vardecl({ name: 'baseColor', value: any('green') })
          ]) as any,
          withType: 'with'
        }, {
          type: 'compose',
          namespace: '*'
        })
      ]);

      const evald = await node.eval(context);
      const composedRules = evald.at(0, context) as Rules;

      // Verify baseColor has the injected value
      const baseColor = getVarWithContext(context, composedRules, 'baseColor');
      expect(baseColor).toBeDefined();
      const baseColorValue = await (baseColor as any).value.eval(context);
      expect(baseColorValue.toTrimmedString({ context })).toBe('green');

      // Verify derivedColor reflects the injected value (linear lookup)
      const derivedColor = getVarWithContext(context, composedRules, 'derivedColor');
      expect(derivedColor).toBeDefined();
      const derivedColorValue = await (derivedColor as any).value.eval(context);
      expect(derivedColorValue.toTrimmedString({ context })).toBe('green');
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
          withNode: rules([
            vardecl({ name: 'baseColor', value: any('yellow') })
          ]) as any,
          withType: 'set'
        }, {
          type: 'compose',
          namespace: '*'
        })
      ]);

      const evald = await node.eval(context);
      const composedRules = evald.at(0, context) as Rules;

      // Verify baseColor has the injected value
      const baseColor = getVarWithContext(context, composedRules, 'baseColor');
      expect(baseColor).toBeDefined();
      const baseColorValue = await (baseColor as any).value.eval(context);
      expect(baseColorValue.toTrimmedString({ context })).toBe('yellow');

      // Verify derivedColor reflects the injected value (scope lookup)
      const derivedColor = getVarWithContext(context, composedRules, 'derivedColor');
      expect(derivedColor).toBeDefined();
      const derivedColorValue = await (derivedColor as any).value.eval(context);
      expect(derivedColorValue.toTrimmedString({ context })).toBe('yellow');
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
          withNode: rules([
            vardecl({ name: 'baseColor', value: any('cyan') })
          ]) as any,
          withType: 'set'
        }, {
          type: 'compose',
          namespace: '*'
        })
      ]);

      const evald = await node.eval(context);
      const composedRules = evald.at(0, context) as Rules;

      // When 'set' is used, structure is flattened:
      // [new injected variables (not found), ...all nodes from imported rules (with replacements)]
      // All variables are in the same Rules scope

      // Verify baseColor was injected (should be the injected one, not the original)
      const baseColor = getVarWithContext(context, composedRules, 'baseColor');
      expect(baseColor).toBeDefined();
      const baseColorValue = await (baseColor as any).value.eval(context);
      expect(baseColorValue.toTrimmedString({ context })).toBe('cyan');

      // Verify derivedColor reflects the injected value (linear lookup)
      // derivedColor is in the composed rules (flattened structure)
      // It should be able to find the injected baseColor in the same scope
      const derivedColor = getVarWithContext(context, composedRules, 'derivedColor');
      expect(derivedColor).toBeDefined();
      // The value should already be evaluated during the import evaluation
      // and should have used the injected baseColor
      const derivedColorValue = await (derivedColor as any).value.eval(context);
      expect(derivedColorValue.toTrimmedString({ context })).toBe('cyan');
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
          withNode: rules([
            vardecl({ name: 'var', value: any('first') })
          ]) as any,
          withType: 'set'
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
          withNode: rules([
            vardecl({ name: 'var', value: any('second') })
          ]) as any,
          withType: 'set'
        }, {
          type: 'compose',
          namespace: '*'
        })
      ]);

      await expect(async () => {
        await node2.eval(context);
      }).rejects.toThrow('Cannot configure a stylesheet more than once');
    });

    it('two sequential "with" imports resolve independently via rendered output', async () => {
      const libraryPath = resolve(process.cwd(), 'library-with-seq.jess');
      context.sourceTrees.set(libraryPath, rules([
        vardecl({ name: 'baseColor', value: any('red') }),
        ruleset({
          selector: sellist([sel([el('.box')])]),
          rules: rules([
            decl({ name: any('color'), value: ref('baseColor', { type: 'variable' }) })
          ])
        })
      ]));

      // First import: baseColor = blue
      const node1 = rules([
        style({
          path: quoted(any('library-with-seq.jess')),
          withNode: rules([
            vardecl({ name: 'baseColor', value: any('blue') })
          ]) as any,
          withType: 'with'
        }, { type: 'compose', namespace: '*' })
      ]);
      const evald1 = await node1.eval(context);
      expect(evald1.render(context)).toContain('color: blue');

      // Second import (fresh context): baseColor = green — must not see blue
      const context2 = createTestContext();
      context2.sourceTrees.set(libraryPath, context.sourceTrees.get(libraryPath)!);
      const node2 = rules([
        style({
          path: quoted(any('library-with-seq.jess')),
          withNode: rules([
            vardecl({ name: 'baseColor', value: any('green') })
          ]) as any,
          withType: 'with'
        }, { type: 'compose', namespace: '*' })
      ]);
      const evald2 = await node2.eval(context2);
      expect(evald2.render(context2)).toContain('color: green');
      expect(evald2.render(context2)).not.toContain('color: blue');
    });

    it('configured compose placements can reuse canonical imported rulesets while rendering with different values', async () => {
      const libraryPath = resolve(process.cwd(), 'library-with-canonical-reuse.jess');
      const sourceRuleset = ruleset({
        selector: sellist([sel([el('.box')])]),
        rules: rules([
          decl({ name: any('color'), value: ref('baseColor', { type: 'variable' }) })
        ])
      });
      const sourceBody = sourceRuleset.get('rules');
      const sourceDecl = sourceBody.at(0, context);
      const sourceTree = rules([
        vardecl({ name: 'baseColor', value: any('red') }),
        sourceRuleset
      ]);

      const evaluateCompose = async (color: string) => {
        const localContext = createTestContext();
        localContext.sourceTrees.set(libraryPath, sourceTree);
        const entry = rules([
          style({
            path: quoted(any('library-with-canonical-reuse.jess')),
            withNode: rules([
              vardecl({ name: 'baseColor', value: any(color) })
            ]) as any,
            withType: 'with'
          }, { type: 'compose', namespace: '*' })
        ]);
        const evald = await entry.eval(localContext);
        const importedRules = evald.at(0, localContext) as Rules;
        const importedRuleset = Array.from(importedRules.value).find(node => isNode(node, N.Ruleset)) as Ruleset;
        return { localContext, evald, importedRules, importedRuleset };
      };

      const blue = await evaluateCompose('blue');
      const green = await evaluateCompose('green');

      const blueDecl = (blue.importedRuleset as any).rules.at(0, blue.localContext);
      const greenDecl = (green.importedRuleset as any).rules.at(0, green.localContext);

      expect(blue.importedRuleset).not.toBe(green.importedRuleset);
      expect(blue.importedRuleset.sourceNode).toBe(sourceRuleset);
      expect(green.importedRuleset.sourceNode).toBe(sourceRuleset);
      expect((blue.importedRuleset as any).rules.sourceNode).toBe(sourceBody);
      expect((green.importedRuleset as any).rules.sourceNode).toBe(sourceBody);
      expect(blueDecl.sourceNode).toBe(sourceDecl);
      expect(greenDecl.sourceNode).toBe(sourceDecl);
      expect(blue.evald.render(blue.localContext)).toContain('color: blue');
      expect(green.evald.render(green.localContext)).toContain('color: green');
      expect(sourceRuleset.parent).toBe(sourceTree);
      expect(sourceBody.parent).toBe(sourceRuleset);
      expect(sourceDecl.parent).toBe(sourceBody);
    });

    it('with replaces existing root vars and nested rules resolve the replacement', async () => {
      const libraryPath = resolve(process.cwd(), 'library-with-replace-root-var.jess');
      context.sourceTrees.set(libraryPath, rules([
        vardecl({ name: 'baseColor', value: any('red') }),
        ruleset({
          selector: sellist([sel([el('.box')])]),
          rules: rules([
            decl({ name: any('color'), value: ref('baseColor', { type: 'variable' }) })
          ])
        })
      ]));

      const node = rules([
        style({
          path: quoted(any('library-with-replace-root-var.jess')),
          withNode: rules([
            vardecl({ name: 'baseColor', value: any('blue') })
          ]) as any,
          withType: 'with'
        }, { type: 'compose', namespace: '*' })
      ]);

      const evald = await node.eval(context);
      expect(evald.render(context)).toContain('color: blue');
      expect(evald.render(context)).not.toContain('color: red');
    });

    it('with injects missing vars and nested rules can reference them during evaluation', async () => {
      const libraryPath = resolve(process.cwd(), 'library-with-inject-var.jess');
      context.sourceTrees.set(libraryPath, rules([
        ruleset({
          selector: sellist([sel([el('.box')])]),
          rules: rules([
            decl({ name: any('color'), value: ref('injectedColor', { type: 'variable' }) })
          ])
        })
      ]));

      const node = rules([
        style({
          path: quoted(any('library-with-inject-var.jess')),
          withNode: rules([
            vardecl({ name: 'injectedColor', value: any('purple') })
          ]) as any,
          withType: 'with'
        }, { type: 'compose', namespace: '*' })
      ]);

      const evald = await node.eval(context);
      expect(evald.render(context)).toContain('color: purple');
    });

    it('set replaces existing root vars and nested rules resolve the replacement', async () => {
      const libraryPath = resolve(process.cwd(), 'library-set-replace-root-var.jess');
      context.sourceTrees.set(libraryPath, rules([
        vardecl({ name: 'baseColor', value: any('red') }),
        ruleset({
          selector: sellist([sel([el('.box')])]),
          rules: rules([
            decl({ name: any('color'), value: ref('baseColor', { type: 'variable' }) })
          ])
        })
      ]));

      const node = rules([
        style({
          path: quoted(any('library-set-replace-root-var.jess')),
          withNode: rules([
            vardecl({ name: 'baseColor', value: any('orange') })
          ]) as any,
          withType: 'set'
        }, { type: 'compose', namespace: '*' })
      ]);

      const evald = await node.eval(context);
      expect(evald.render(context)).toContain('color: orange');
      expect(evald.render(context)).not.toContain('color: red');
    });

    it('set injects missing vars and nested rules can reference them during evaluation', async () => {
      const libraryPath = resolve(process.cwd(), 'library-set-inject-var.jess');
      context.sourceTrees.set(libraryPath, rules([
        ruleset({
          selector: sellist([sel([el('.box')])]),
          rules: rules([
            decl({ name: any('color'), value: ref('injectedColor', { type: 'variable' }) })
          ])
        })
      ]));

      const node = rules([
        style({
          path: quoted(any('library-set-inject-var.jess')),
          withNode: rules([
            vardecl({ name: 'injectedColor', value: any('teal') })
          ]) as any,
          withType: 'set'
        }, { type: 'compose', namespace: '*' })
      ]);

      const evald = await node.eval(context);
      expect(evald.render(context)).toContain('color: teal');
    });

    it('set values become the baseline for later compose imports of the same file', async () => {
      const libraryPath = resolve(process.cwd(), 'library-set-baseline.jess');
      context.sourceTrees.set(libraryPath, rules([
        vardecl({ name: 'baseColor', value: any('red') }),
        ruleset({
          selector: sellist([sel([el('.box')])]),
          rules: rules([
            decl({ name: any('color'), value: ref('baseColor', { type: 'variable' }) })
          ])
        })
      ]));

      const node = rules([
        style({
          path: quoted(any('library-set-baseline.jess')),
          withNode: rules([
            vardecl({ name: 'baseColor', value: any('blue') })
          ]) as any,
          withType: 'set'
        }, { type: 'compose', namespace: '*' }),
        style({
          path: quoted(any('library-set-baseline.jess'))
        }, {
          type: 'compose',
          namespace: '*',
          importOptions: { multiple: true }
        })
      ]);

      const evald = await node.eval(context);
      const first = evald.at(0, context) as Rules;
      const second = evald.at(1, context) as Rules;

      const firstBaseColor = getVarWithContext(context, first, 'baseColor');
      const secondBaseColor = getVarWithContext(context, second, 'baseColor');

      expect((await (firstBaseColor as any).value.eval(context)).toTrimmedString({ context })).toBe('blue');
      expect((await (secondBaseColor as any).value.eval(context)).toTrimmedString({ context })).toBe('blue');
      expect(second.render(context)).toContain('color: blue');
    });

    it('with can override a prior set baseline for the same file', async () => {
      const libraryPath = resolve(process.cwd(), 'library-set-with-override.jess');
      context.sourceTrees.set(libraryPath, rules([
        vardecl({ name: 'baseColor', value: any('red') }),
        ruleset({
          selector: sellist([sel([el('.box')])]),
          rules: rules([
            decl({ name: any('color'), value: ref('baseColor', { type: 'variable' }) })
          ])
        })
      ]));

      const node = rules([
        style({
          path: quoted(any('library-set-with-override.jess')),
          withNode: rules([
            vardecl({ name: 'baseColor', value: any('blue') })
          ]) as any,
          withType: 'set'
        }, { type: 'compose', namespace: '*' }),
        style({
          path: quoted(any('library-set-with-override.jess')),
          withNode: rules([
            vardecl({ name: 'baseColor', value: any('green') })
          ]) as any,
          withType: 'with'
        }, {
          type: 'compose',
          namespace: '*',
          importOptions: { multiple: true }
        })
      ]);

      const evald = await node.eval(context);
      const first = evald.at(0, context) as Rules;
      const second = evald.at(1, context) as Rules;

      const firstBaseColor = getVarWithContext(context, first, 'baseColor');
      const secondBaseColor = getVarWithContext(context, second, 'baseColor');

      expect((await (firstBaseColor as any).value.eval(context)).toTrimmedString({ context })).toBe('blue');
      expect((await (secondBaseColor as any).value.eval(context)).toTrimmedString({ context })).toBe('green');
      expect(first.render(context)).toContain('color: blue');
      expect(second.render(context)).toContain('color: green');
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

    it('evaluated postlude wrapping does not corrupt canonical postlude parent pointers', async () => {
      const importPath = resolve(process.cwd(), 'postlude-parent.jess');
      context.sourceTrees.set(importPath, rules([
        ruleset({
          selector: sellist([sel([el('.postlude-parent')])]),
          rules: rules([
            decl({ name: any('color'), value: any('red') })
          ])
        })
      ]));

      const layerArg = any('theme');
      const layerArgs = list([layerArg]);
      const supportsArgs = list([any('(display: grid)'), any('and (hover: hover)')]);
      const mediaQuery = any('screen and (min-width: 600px)');
      const postlude = list([
        call({ name: 'layer', args: layerArgs }),
        call({ name: 'supports', args: supportsArgs }),
        mediaQuery
      ], { sep: ' ' as any });

      expect(layerArg.parent).toBe(layerArgs);
      expect(supportsArgs.parent).toBe(postlude.get('value')[1]);
      expect(mediaQuery.parent).toBe(postlude);

      await rules([
        style({ path: quoted(any('postlude-parent.jess')) }, {
          type: 'import',
          importOptions: { postlude }
        })
      ]).eval(context);

      expect(layerArg.parent).toBe(layerArgs);
      expect(supportsArgs.parent).toBe(postlude.get('value')[1]);
      expect(mediaQuery.parent).toBe(postlude);
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
      expect(resolvedFromInterpolatedImport.toTrimmedString({ context })).toBe('$interpolationResolved: ok');
    });

    it('import path resolution uses a state-evaluated Url path value', async () => {
      const resolvedImportPath = resolve(process.cwd(), 'import/url-state-path.jess');
      context.sourceTrees.set(resolvedImportPath, rules([
        vardecl({ name: 'resolvedFromUrl', value: any('ok') })
      ]));

      const importNode = style({
        path: url(quoted('wrong-path.jess'))
      }, { type: 'import' });
      const renderKey = context.nextRenderKey();
      addEdge(importNode, 'path', renderKey, url(quoted('import/url-state-path.jess')));
      importNode.renderKey = renderKey;
      const node = rules([
        importNode
      ]);
      const preEvald = await (node as any).preEval(context);
      const preEvaldImport = preEvald.at(0, context);

      const evald = await node.eval(context);
      const resolvedFromUrl = getVarWithContext(context, evald, 'resolvedFromUrl');

      expect(resolvedFromUrl).toBeDefined();
      expect(resolvedFromUrl.toTrimmedString({ context })).toBe('$resolvedFromUrl: ok');
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
      expect(evald.render(context).split('.once').length - 1).toBe(1);
    });

    it('second same-file import defaults to reference mode without multiple', async () => {
      const libraryPath = resolve(process.cwd(), 'import-reference-default.jess');
      context.sourceTrees.set(libraryPath, rules([
        ruleset({
          selector: sellist([sel([el('.once-ref')])]),
          rules: rules([decl({ name: any('color'), value: any('red') })])
        })
      ]));

      const node = rules([
        style({ path: quoted(any('import-reference-default.jess')) }, { type: 'import' }),
        style({ path: quoted(any('import-reference-default.jess')) }, { type: 'import' })
      ]);

      const evald = await node.eval(context);
      const first = evald.at(0, context) as Rules;
      const second = evald.at(1, context) as Rules;

      expect(first.options.referenceMode).not.toBe(true);
      expect(second.options.referenceMode).toBe(true);
      expect(evald.render(context).split('.once-ref').length - 1).toBe(1);
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
      const imported = evald.at(0, context) as Rules;
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
      const declaration = evald.at(1, context) as any;
      const evaldCtx = asRulesContext(context, evald);
      const resolved = await declaration.eval(evaldCtx);
      expect(resolved.toTrimmedString({ context: evaldCtx })).toBe('value: 42');
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
      const imported = evald.at(0, context) as Rules;
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
      expect(countSelector(evald.render(context), '.repeat')).toBe(2);
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
      expect(countSelector(evald.render(context), '.mix-order')).toBe(1);
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
      expect(countSelector(evald.render(context), '.mix-order-rev')).toBe(0);
    });

    it('deduped imports do not corrupt canonical top-level ruleset child parents', async () => {
      const importedRuleset = ruleset({
        selector: sellist([sel([el('.dedupe-parent')])]),
        rules: rules([decl({ name: any('color'), value: any('red') })])
      });
      const sourceRules = rules([importedRuleset]);
      context.sourceTrees.set('dedupe-parents.jess', sourceRules);

      expect(importedRuleset.get('rules').parent).toBe(importedRuleset);
      expect(importedRuleset.get('selector').parent).toBe(importedRuleset);

      const node = rules([
        style({ path: quoted(any('dedupe-parents.jess')) }, { type: 'import' }),
        style({ path: quoted(any('dedupe-parents.jess')) }, { type: 'import' })
      ]);

      await node.eval(context);

      expect(importedRuleset.get('rules').parent).toBe(importedRuleset);
      expect(importedRuleset.get('selector').parent).toBe(importedRuleset);
    });

    it('deduped imports materialize top-level declaration parents in returned trees without corrupting canonical source parents', async () => {
      const libraryPath = resolve(process.cwd(), 'dedupe-vars.jess');
      const importedVar = vardecl({ name: 'dedupeVar', value: any('red') });
      const sourceRules = rules([importedVar]);
      context.sourceTrees.set(libraryPath, sourceRules);
      const cachedEvaldRules = rules([
        vardecl({ name: 'dedupeVar', value: any('red') })
      ]);
      context.evaldTrees.set(libraryPath, cachedEvaldRules);

      expect(importedVar.parent).toBe(sourceRules);

      const node = rules([
        style({ path: quoted(any('dedupe-vars.jess')) }, { type: 'import' })
      ]);

      const evald = await node.eval(context);
      const dedupedImport = evald.at(0, context) as Rules;
      const dedupedVar = dedupedImport.at(0, context) as VarDeclaration;
      const dedupedCtx = asRulesContext(context, dedupedImport);

      expect(getParent(dedupedVar, dedupedCtx)).toBe(dedupedImport);
      expect(dedupedVar).not.toBe(importedVar);
      expect(dedupedVar.toTrimmedString({ context })).toBe('$dedupeVar: red');
      expect(importedVar.parent).toBe(sourceRules);
    });

    it('shallow top-level child clones keep nested canonical children parented to the source ruleset', () => {
      const canonicalRuleset = ruleset({
        selector: sellist([sel([el('.dedupe-shallow')])]),
        rules: rules([decl({ name: any('color'), value: any('red') })])
      });

      const canonicalSelector = canonicalRuleset.get('selector');
      const canonicalBody = canonicalRuleset.get('rules');

      expect(canonicalSelector.parent).toBe(canonicalRuleset);
      expect(canonicalBody.parent).toBe(canonicalRuleset);

      const shallowClone = canonicalRuleset.clone(false);

      expect(shallowClone).not.toBe(canonicalRuleset);
      expect(shallowClone.get('selector')).toBe(canonicalSelector);
      expect(shallowClone.get('rules')).toBe(canonicalBody);
      expect(canonicalSelector.parent).toBe(canonicalRuleset);
      expect(canonicalBody.parent).toBe(canonicalRuleset);
      expect(shallowClone.toTrimmedString({ context })).toContain('color: red');
    });

    it('returned-tree wrappers do not canonically reparent shared top-level children', () => {
      const canonicalRuleset = ruleset({
        selector: sellist([sel([el('.wrapper-blocker')])]),
        rules: rules([decl({ name: any('color'), value: any('red') })])
      });
      const evaluatedRules = rules([canonicalRuleset]);

      expect(canonicalRuleset.parent).toBe(evaluatedRules);

      const shallowWrapper = evaluatedRules.clone(false);

      expect(shallowWrapper).not.toBe(evaluatedRules);
      expect(shallowWrapper.at(0, context)).toBe(canonicalRuleset);
      expect(canonicalRuleset.parent).toBe(evaluatedRules);
      expect(shallowWrapper.toTrimmedString({ context })).toContain('.wrapper-blocker');
    });

    it.skip('deduped import wrappers keep cached evaluated parent pointers stable with detached wrapper finalization', async () => {
      const libraryPath = resolve(process.cwd(), 'dedupe-ruleset-identity.jess');
      const sourceRuleset = ruleset({
        selector: sellist([sel([el('.dedupe-identity')])]),
        rules: rules([
          decl({ name: any('color'), value: ref('libColor', { type: 'variable' }) })
        ])
      });
      context.sourceTrees.set(libraryPath, rules([sourceRuleset]));

      const cachedRuleset = ruleset({
        selector: sellist([sel([el('.dedupe-identity')])]),
        rules: rules([
          decl({ name: any('color'), value: any('red') })
        ])
      });
      cachedRuleset.sourceNode = sourceRuleset;
      const cachedEvaldRules = rules([cachedRuleset]);
      cachedEvaldRules.sourceNode = context.sourceTrees.get(libraryPath)!;
      context.evaldTrees.set(libraryPath, cachedEvaldRules);
      const originalCachedParent = cachedRuleset.parent;

      const node = rules([
        style({ path: quoted(any('dedupe-ruleset-identity.jess')) }, { type: 'import' })
      ]);

      const evald = await node.eval(context);
      const dedupedImport = evald.at(0, context) as Rules;
      const dedupedRuleset = dedupedImport.at(0, context) as Ruleset;

      expect(dedupedRuleset).not.toBe(cachedRuleset);
      expect(dedupedRuleset.parent).toBe(dedupedImport);
      expect(cachedRuleset.parent).toBe(originalCachedParent);
      expect(dedupedRuleset.toTrimmedString({ context })).toContain('color: red');
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
      expect(countSelector(evald.render(context), '.compose-repeat')).toBe(2);
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
      const css = evald.render(context);
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
      const first = evald.at(0, context) as Rules;
      const second = evald.at(1, context) as Rules;
      expect(first.options.rulesVisibility.Ruleset).toBe('public');
      expect(second.options.rulesVisibility.Ruleset).toBe('private');
    });

    it.skip('compose cache wrappers still share top-level evaluated child identity across per-import visibility wrappers', async () => {
      const libraryPath = 'library-wrapper-contract.jess';
      context.sourceTrees.set(libraryPath, rules([
        ruleset({
          selector: sellist([sel([el('.imported')])]),
          rules: rules([
            decl({ name: any('color'), value: any('red') })
          ])
        })
      ]));

      const node = rules([
        style(
          { path: quoted(any(libraryPath)) },
          { type: 'compose', namespace: '*', importOptions: { mutable: true } }
        ),
        style(
          { path: quoted(any(libraryPath)) },
          { type: 'compose', namespace: '*', importOptions: { mutable: false, multiple: true } }
        )
      ]);

      const evald = await node.eval(context);
      const first = evald.at(0, context) as Rules;
      const second = evald.at(1, context) as Rules;
      const firstRuleset = first.at(0, context) as Ruleset;
      const secondRuleset = second.at(0, context) as Ruleset;
      const cachedEvaldRules = context.evaldTrees.get(libraryPath)!;
      const cachedRuleset = cachedEvaldRules.at(0, context) as Ruleset;

      expect(first.options.rulesVisibility.Ruleset).toBe('public');
      expect(second.options.rulesVisibility.Ruleset).toBe('private');
      expect(cachedEvaldRules).not.toBe(first);
      expect(cachedEvaldRules).not.toBe(second);
      expect(first.options).not.toBe(second.options);
      expect(first.options).not.toBe(cachedEvaldRules.options);
      expect(second.options).not.toBe(cachedEvaldRules.options);
      expect(first.value).toBe(cachedEvaldRules.value);
      expect(second.value).toBe(cachedEvaldRules.value);
      expect(first.value[0]).toBe(cachedRuleset);
      expect(second.value[0]).toBe(cachedRuleset);
      expect(firstRuleset).toBe(cachedRuleset);
      expect(firstRuleset).toBe(secondRuleset);
      expect(firstRuleset.parent).not.toBe(first);
      expect(firstRuleset.parent).not.toBe(second);
      expect(firstRuleset.toTrimmedString({ context })).toContain('.imported');
    });
  });
});
