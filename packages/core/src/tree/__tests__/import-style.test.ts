/* eslint-disable @typescript-eslint/no-unsafe-type-assertion */
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
  condition,
  comment,
  expr,
  defaultguard,
  sellist,
  quoted,
  amp,
  pseudo,
  co,
  Interpolated,
  interpolatedSelector,
  INTERPOLATION_PLACEHOLDER,
  type Rules,
  Node,
  Any,
  atrule
} from '../index.js';
import { Rules as RulesClass } from '../index.js';
import { getImportPlacementChildSegments, getImportPlacementReferenceMode, getImportPlacementRenderState, getImportPlacementRulesVisibility, getImportPlacementSegmentSourceChild, getImportPlacementSourceChild, getImportPostludePlacement, getImportPostludeRenderOrder, getImportPostludeRenderState } from '../import-style.js';
import { isNode } from '../util/is-node.js';
import { N } from '../node-type.js';
import { Context, TreeContext } from '../../context.js';
import type { CallableFindOptions, DeclarationFindOptions } from '../util/lookup-utils.js';
import { createRenderBuffer, renderNodeToString } from '../util/render-buffer.js';
import { OutputWriter, getPrintOptions } from '../util/print.js';
import { buildSourceMap } from '../util/sourcemap.js';
import { resolve } from 'node:path';
import { createTestContext } from './import-style-test-helpers.js';
import { findPropertyDeclarationOccurrence, findVariableDeclarationOccurrence } from '../util/direct-rules-lookup.js';

let context: Context;

describe('Style import construction', () => {
  it('preserves parser tree context on construction', () => {
    const treeContext = new TreeContext();
    const node = style({
      path: quoted('module.jess')
    }, { type: 'compose' }, undefined, treeContext);

    expect(node._treeContext).toBe(treeContext);
  });
});

function getVarWithContext(context: Context, n: Rules, key: string, opts: DeclarationFindOptions = {}) {
  context.rulesContext = n;
  return findVariableDeclarationOccurrence(n, key, {
    ...opts,
    context: opts.context ?? context,
    searchParents: true
  })?.node;
}

function getMixinWithContext(context: Context, n: Rules, key: string, opts: CallableFindOptions = {}) {
  context.rulesContext = n;
  return n.findMixin(key, 'Mixin', {
    ...opts,
    context: opts.context ?? context,
    searchParents: true
  });
}

describe('Style import', () => {
  beforeAll(() => {
    Node.prototype.fullRender = true;
  });

  beforeEach(() => {
    context = createTestContext();
  });

  describe('variable visibility', () => {
    it('style import Rules promotion preserves unrelated direct declaration cache entries', async () => {
      const importedPath = resolve(process.cwd(), 'imported-direct-declaration-cache.jess');
      context.sourceTrees.set(importedPath, rules([
        decl({ name: any('imported-color'), value: any('green') })
      ]));
      const node = rules([
        style({
          path: quoted(any('imported-direct-declaration-cache.jess'))
        }, {
          type: 'import'
        }),
        decl({ name: any('color'), value: any('blue') })
      ]);

      await node.prepareRegistration(context);
      expect(findPropertyDeclarationOccurrence(node, 'color')?.node.value.valueOf()).toBe('blue');
      expect(findPropertyDeclarationOccurrence(node, 'missing')).toBeUndefined();
      expect(findPropertyDeclarationOccurrence(node, 'imported-color')).toBeUndefined();
      const buckets = node.directDeclarationsByName;
      const colorBucket = buckets?.get('color');
      const cache = node.directDeclarationLookupCache;
      const colorCacheKeys = [...(cache?.keys() ?? [])].filter(key => key.startsWith('color\u001f'));
      const missingCacheKeys = [...(cache?.keys() ?? [])].filter(key => key.startsWith('missing\u001f'));
      const importedLookupVersion = node.getDeclarationLookupVersion('imported-color');
      const declarationLookupVersion = node.declarationLookupVersion;
      expect(colorBucket).toBeDefined();
      expect(colorCacheKeys.length).toBeGreaterThan(0);
      expect(missingCacheKeys.length).toBeGreaterThan(0);

      await node.eval(context);

      expect(node.declarationLookupVersion).toBe(declarationLookupVersion);
      expect(node.getDeclarationLookupVersion('imported-color')).toBeGreaterThan(importedLookupVersion);
      expect(node.directDeclarationsByName).toBe(buckets);
      expect(node.directDeclarationsByName?.get('color')).toBe(colorBucket);
      expect([...((node.directDeclarationLookupCache ?? new Map()).keys())].filter(
        key => key.startsWith('color\u001f')
      )).toEqual(colorCacheKeys);
      expect([...((node.directDeclarationLookupCache ?? new Map()).keys())].filter(
        key => key.startsWith('missing\u001f')
      )).toEqual(missingCacheKeys);
      expect([...((node.directDeclarationLookupCache ?? new Map()).keys())].filter(
        key => key.startsWith('imported-color\u001f')
      )).toEqual([]);
      expect(findPropertyDeclarationOccurrence(node, 'imported-color')?.node.value.valueOf()).toBe('green');
    });

    it('tracks reference-import presence on evaluated Rules wrappers', async () => {
      const importedPath = resolve(process.cwd(), 'tracked-reference-import.jess');
      context.sourceTrees.set(importedPath, rules([
        ruleset({
          selector: sellist([sel([el('.tracked')])]),
          rules: rules([
            decl({ name: any('color'), value: any('red') })
          ])
        })
      ]));

      const plainNode = rules([
        style({
          path: quoted(any('tracked-reference-import.jess'))
        }, {
          type: 'import'
        })
      ]);
      const referenceNode = rules([
        style({
          path: quoted(any('tracked-reference-import.jess'))
        }, {
          type: 'import',
          importOptions: { reference: true }
        })
      ]);

      const plainEvald = await plainNode.eval(context);
      const referenceEvald = await referenceNode.eval(context);

      expect((plainEvald.at(0) as Rules)._hasReferenceImports).toBe(false);
      expect((referenceEvald.at(0) as Rules)._hasReferenceImports).toBe(true);
    });

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
      expect(importedDecl.toTrimmedString()).toBe('color: red');
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
      expect(resolved.toTrimmedString()).toBe('color: blue');
    });

    it('restores compose extend root when imported rules eval throws', async () => {
      const composedPath = resolve(process.cwd(), 'compose-throws.jess');
      const composedRules = rules([]);
      composedRules.eval = () => {
        throw new Error('compose eval failed');
      };
      context.sourceTrees.set(composedPath, composedRules);
      const parentRoot = rules([]);
      context.extendRoots.registerRoot(parentRoot);
      context.extendRoots.pushExtendRoot(parentRoot);
      const extendRootStackLength = context.extendRoots.extendRootStack.length;
      const node = style({
        path: quoted(any('compose-throws.jess'))
      }, {
        type: 'compose',
        namespace: '*'
      });

      await expect(node.eval(context)).rejects.toThrow('compose eval failed');
      expect(context.extendRoots.extendRootStack).toHaveLength(extendRootStackLength);
    });

    it('tracks non-classic import boundaries on Rules options, not source provenance', async () => {
      const composedPath = resolve(process.cwd(), 'composed-boundary.jess');
      context.sourceTrees.set(composedPath, rules([
        ruleset({
          selector: sellist([sel([el('.composed')])]),
          rules: rules([
            decl({ name: any('color'), value: ref('parentVar', { type: 'variable', fallbackValue: any('blue') }) })
          ])
        })
      ]));

      const node = rules([
        vardecl({ name: 'parentVar', value: any('red') }),
        style({
          path: quoted(any('composed-boundary.jess'))
        }, {
          type: 'compose',
          namespace: '*'
        })
      ]);

      const evald = await node.eval(context);
      const composedRules = evald.at(1) as Rules;
      const composedRuleset = composedRules.at(0);

      expect(composedRules.options.importBoundary).toBe(true);
      expect(composedRules.sourceNode).toBe(composedRules);

      const composedDecl = (composedRuleset as any).rules.at(0);
      const resolved = await composedDecl.eval(context);
      expect(resolved.toTrimmedString()).toBe('color: blue');
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
      expect(resolved.toTrimmedString()).toBe('color: green');
    });

    it('import type variables visible to parent do not fall back to broad declaration find', async () => {
      context.sourceTrees.set('imported.jess', rules([
        vardecl({ name: 'importedVar', value: any('green') })
      ]));

      const originalFind = RulesClass.prototype.find;
      const declarationHits: string[] = [];
      RulesClass.prototype.find = function(...args: Parameters<typeof originalFind>) {
        const [type, key, filterType] = args;
        if (type === 'declaration' && filterType === 'VarDeclaration' && key === 'importedVar') {
          declarationHits.push(key);
        }
        return originalFind.apply(this, args);
      };

      try {
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
        expect(resolved.toTrimmedString()).toBe('color: green');
        expect(declarationHits).toHaveLength(0);
      } finally {
        RulesClass.prototype.find = originalFind;
      }
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
      expect(resolved.toTrimmedString()).toBe('color: purple');
    });

    it('compose type variables visible to parent do not fall back to broad declaration find', async () => {
      const composedPath = resolve(process.cwd(), 'composed.jess');
      context.sourceTrees.set(composedPath, rules([
        vardecl({ name: 'composedVar', value: any('purple') })
      ]));

      const originalFind = RulesClass.prototype.find;
      const declarationHits: string[] = [];
      RulesClass.prototype.find = function(...args: Parameters<typeof originalFind>) {
        const [type, key, filterType] = args;
        if (type === 'declaration' && filterType === 'VarDeclaration' && key === 'composedVar') {
          declarationHits.push(key);
        }
        return originalFind.apply(this, args);
      };

      try {
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
        expect(resolved.toTrimmedString()).toBe('color: purple');
        expect(declarationHits).toHaveLength(0);
      } finally {
        RulesClass.prototype.find = originalFind;
      }
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
      expect(resolved.toTrimmedString()).toContainString('color: blue');
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
      expect(resolved.toTrimmedString()).toContainString('color: yellow');
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
      expect(resolved1.toTrimmedString()).toContainString('color: white');
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
      expect(importedRuleset.toTrimmedString()).toContainString('.imported');
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
      expect(varDecl.toTrimmedString()).toBe('$importedVar: modified');
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
      expect(varDecl.toTrimmedString()).toBe('$composedVar: modified');
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
      expect(downstreamLookup.toTrimmedString()).toBe('$forwardedVar: ok');
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
      const css = await renderNodeToString(node, context, { context });

      expect(composedRules.rules.some(child => isNode(child, N.Rules))).toBe(false);
      expect(composedRules.options.importBoundary).toBe(true);

      // Test 1: Verify injected variables are accessible
      const injectedVar = getVarWithContext(context, composedRules, 'primaryColor');
      expect(injectedVar).toBeDefined();
      // The variable declaration exists, which means the injection worked
      // We can verify the value by evaluating the variable's value property
      const injectedVarValueNode = injectedVar!.value;
      const injectedVarValue = await injectedVarValueNode.eval(context);
      expect(injectedVarValue.toTrimmedString()).toBe('purple');

      // Test 2: Verify computed values based on injected variables are correct
      expect(css).toContain('color: purple');
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
      const css = await renderNodeToString(node, context, { context });

      expect(composedRules.rules.some(child => isNode(child, N.Rules))).toBe(false);

      // Test 1: Verify injected variables are accessible
      const injectedVar = getVarWithContext(context, composedRules, 'primaryColor');
      expect(injectedVar).toBeDefined();
      // The variable declaration exists, which means the injection worked
      // We can verify the value by evaluating the variable's value property
      const injectedVarValueNode = injectedVar!.value;
      const injectedVarValue = await injectedVarValueNode.eval(context);
      expect(injectedVarValue.toTrimmedString()).toBe('orange');

      // Test 2: Verify computed values based on injected variables are correct
      expect(css).toContain('color: orange');
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
      const baseColorValue = await baseColor!.value.eval(context);
      expect(baseColorValue.toTrimmedString()).toBe('blue');

      // Verify derivedColor reflects the injected value (scope lookup)
      const derivedColor = getVarWithContext(context, composedRules, 'derivedColor');
      expect(derivedColor).toBeDefined();
      const derivedColorValue = await derivedColor!.value.eval(context);
      expect(derivedColorValue.toTrimmedString()).toBe('blue');
    });

    it('updates computed variables with "with" type - source-position lookup', async () => {
      // Test that when we inject a variable, dependent variables are updated
      // This tests explicit source-position lookup ($!var)
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
      const baseColorValue = await baseColor!.value.eval(context);
      expect(baseColorValue.toTrimmedString()).toBe('green');

      // Verify derivedColor reflects the injected value (linear lookup)
      const derivedColor = getVarWithContext(context, composedRules, 'derivedColor');
      expect(derivedColor).toBeDefined();
      const derivedColorValue = await derivedColor!.value.eval(context);
      expect(derivedColorValue.toTrimmedString()).toBe('green');
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
      const baseColorValue = await baseColor!.value.eval(context);
      expect(baseColorValue.toTrimmedString()).toBe('yellow');

      // Verify derivedColor reflects the injected value (scope lookup)
      const derivedColor = getVarWithContext(context, composedRules, 'derivedColor');
      expect(derivedColor).toBeDefined();
      const derivedColorValue = await derivedColor!.value.eval(context);
      expect(derivedColorValue.toTrimmedString()).toBe('yellow');
    });

    it('updates computed variables with "set" type - source-position lookup', async () => {
      // Test that when we inject a variable with "set", dependent variables are updated
      // This tests explicit source-position lookup ($!var)
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
      const baseColorValue = await baseColor!.value.eval(context);
      expect(baseColorValue.toTrimmedString()).toBe('cyan');

      // Verify derivedColor reflects the injected value (linear lookup)
      // derivedColor is in the composed rules (flattened structure)
      // It should be able to find the injected baseColor in the same scope
      const derivedColor = getVarWithContext(context, composedRules, 'derivedColor');
      expect(derivedColor).toBeDefined();
      // The value should already be evaluated during the import evaluation
      // and should have used the injected baseColor
      const derivedColorValue = await derivedColor!.value.eval(context);
      expect(derivedColorValue.toTrimmedString()).toBe('cyan');
    });

    it('keeps replacement "set" configs visible to imported detached ruleset variable closures', async () => {
      const libraryPath = resolve(process.cwd(), 'library-detached-closure-set.jess');
      context.sourceTrees.set(libraryPath, rules([
        vardecl({ name: 'accentColor', value: any('red') }),
        mixin({
          name: any('.use-accent'),
          rules: rules([
            vardecl({
              name: 'accent-content',
              value: rules([
                decl({ name: any('border-color'), value: ref({ key: 'accentColor' }, { type: 'variable' }) })
              ])
            }),
            call({
              name: ref({ key: 'accent-content' }, { type: 'variable' })
            })
          ])
        })
      ]));

      const node = rules([
        style({
          path: quoted(any('library-detached-closure-set.jess')),
          with: {
            node: rules([
              vardecl({ name: 'accentColor', value: any('purple') })
            ]),
            type: 'set'
          }
        }, {
          type: 'compose',
          namespace: '*'
        }),
        ruleset({
          selector: el('.consumer'),
          rules: rules([
            call({
              name: ref({ key: '.use-accent' }, { type: 'mixin-ruleset' }),
              args: list([])
            })
          ])
        })
      ]);

      const css = await renderNodeToString(node, context, { context });

      expect(css).toContain('.consumer {');
      expect(css).toContain('border-color: purple;');
      expect(css).not.toContain('border-color: red;');
    });

    it('reuses imported rules when "with" produces no effective changes', async () => {
      const libraryPath = resolve(process.cwd(), 'library.jess');
      const importedRules = rules([
        ruleset({
          selector: sellist([sel([el('.box')])]),
          rules: rules([
            decl({ name: any('color'), value: any('black') })
          ])
        })
      ]);
      context.sourceTrees.set(libraryPath, importedRules);

      const node = rules([
        style({
          path: quoted(any('library.jess')),
          with: {
            node: rules([]),
            type: 'with'
          }
        }, {
          type: 'import'
        })
      ]);

      const evald = await node.eval(context);
      const imported = evald.at(0) as Rules;
      const css = await renderNodeToString(node, context, { context });

      expect(imported).toBe(importedRules);
      expect(css).toContain('.box');
    });

    it('keeps additive non-variable "with" configs on a child rules surface', async () => {
      const originalFind = RulesClass.prototype.find;
      const declarationBridgeHits: string[] = [];
      const libraryPath = resolve(process.cwd(), 'library.jess');
      context.sourceTrees.set(libraryPath, rules([
        vardecl({ name: 'baseColor', value: any('black') }),
        vardecl({ name: 'derivedColor', value: ref('baseColor', { type: 'variable' }) }),
        ruleset({
          selector: sellist([sel([el('.base')])]),
          rules: rules([
            decl({ name: any('color'), value: ref('derivedColor', { type: 'variable' }) })
          ])
        })
      ]));

      const node = rules([
        style({
          path: quoted(any('library.jess')),
          with: {
            node: rules([
              ruleset({
                selector: sellist([sel([el('.addon')])]),
                rules: rules([
                  decl({ name: any('color'), value: any('red') }),
                  decl({ name: any('configuredProp'), value: any('configured') })
                ])
              })
            ]),
            type: 'with'
          }
        }, {
          type: 'compose',
          namespace: '*'
        }),
        ruleset({
          selector: sellist([sel([el('.use-configured')])]),
          rules: rules([
            decl({ name: any('prop-hit'), value: ref('configuredProp', { type: 'property' }) })
          ])
        })
      ]);
      RulesClass.prototype.find = function(...args: Parameters<typeof originalFind>) {
        const [type, key, filterType] = args;
        if (type === 'declaration' && key === 'configuredProp') {
          declarationBridgeHits.push(`${filterType}:${key}`);
        }
        return originalFind.apply(this, args);
      };

      try {
        const evald = await node.eval(context);
        const composedRules = evald.at(0) as Rules;
        const importedChildSurface = composedRules.rules.find(child => isNode(child, N.Rules)) as Rules | undefined;
        const css = await renderNodeToString(node, context, { context });

        expect(composedRules.rules.some(child => isNode(child, N.Rules))).toBe(true);
        expect(composedRules.options.importBoundary).toBe(true);
        expect(importedChildSurface?.options.importBoundary).toBeUndefined();
        expect(css).toContain('.base');
        expect(css).toContain('.addon');
        expect(css).toContain('color: black');
        expect(css).toContain('prop-hit: configured;');
        expect(declarationBridgeHits).toEqual([]);
      } finally {
        RulesClass.prototype.find = originalFind;
      }
    });

    it('keeps variable-only additive "with" configs on the imported rules surface', async () => {
      const libraryPath = resolve(process.cwd(), 'library.jess');
      context.sourceTrees.set(libraryPath, rules([
        ruleset({
          selector: sellist([sel([el('.base')])]),
          rules: rules([
            decl({ name: any('color'), value: ref('accentColor', { type: 'variable' }) })
          ])
        })
      ]));

      const node = rules([
        style({
          path: quoted(any('library.jess')),
          with: {
            node: rules([
              vardecl({ name: 'accentColor', value: any('purple') })
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
      const css = await renderNodeToString(node, context, { context });

      expect(composedRules.rules.some(child => isNode(child, N.Rules))).toBe(false);
      expect(composedRules.options.importBoundary).toBe(true);
      const injectedVar = getVarWithContext(context, composedRules, 'accentColor');
      expect(injectedVar).toBeDefined();
      const injectedVarValue = await injectedVar!.value.eval(context);
      expect(injectedVarValue.toTrimmedString()).toBe('purple');
      expect(css).toContain('.base');
      expect(css).toContain('color: purple');
    });

    it('keeps variable-only additive "with" configs visible to imported guarded mixins', async () => {
      const originalFindMixinsFast = RulesClass.prototype.findMixinsFast;
      const directChildSurfaceBridges: string[] = [];
      const libraryPath = resolve(process.cwd(), 'library-guarded-mixin.jess');
      context.sourceTrees.set(libraryPath, rules([
        mixin({
          name: any('.configured-guarded'),
          params: list([
            any('color', { role: 'property' })
          ]),
          guard: condition([
            condition([
              expr(ref({ key: 'mode' }, { type: 'variable' })),
              '=',
              any('dark')
            ]),
            'and',
            condition([
              expr(ref({ key: 'accentColor' }, { type: 'variable' })),
              '=',
              any('purple')
            ])
          ]),
          rules: rules([
            decl({ name: any('color'), value: ref({ key: 'color' }, { type: 'variable' }) }),
            decl({ name: any('border-color'), value: ref({ key: 'accentColor' }, { type: 'variable' }) })
          ])
        })
      ]));

      const node = rules([
        style({
          path: quoted(any('library-guarded-mixin.jess')),
          with: {
            node: rules([
              vardecl({ name: 'accentColor', value: any('purple') })
            ]),
            type: 'with'
          }
        }, {
          type: 'compose',
          namespace: '*'
        }),
        ruleset({
          selector: el('.dark'),
          rules: rules([
            vardecl({ name: 'mode', value: any('dark') }),
            call({
              name: ref({ key: '.configured-guarded' }, { type: 'mixin-ruleset' }),
              args: list([any('red')])
            })
          ])
        }),
        ruleset({
          selector: el('.light'),
          rules: rules([
            vardecl({ name: 'mode', value: any('light') }),
            call({
              name: ref({ key: '.configured-guarded' }, { type: 'mixin-ruleset' }),
              args: list([any('red')])
            })
          ])
        })
      ]);

      RulesClass.prototype.findMixinsFast = function(...args: Parameters<typeof originalFindMixinsFast>) {
        const [key, options] = args;
        if (key === '.configured-guarded' && options?.searchParents === false) {
          directChildSurfaceBridges.push(key);
        }
        return originalFindMixinsFast.apply(this, args);
      };

      try {
        const css = await renderNodeToString(node, context, { context });

        expect(css).toContain('.dark {');
        expect(css).toContain('color: red;');
        expect(css).toContain('border-color: purple;');
        expect(css).not.toContain('.light {\n  color: red;');
        expect(directChildSurfaceBridges).toEqual([]);
      } finally {
        RulesClass.prototype.findMixinsFast = originalFindMixinsFast;
      }
    });

    it('keeps replacement "set" configs visible to imported guarded mixins', async () => {
      const originalFindMixinsFast = RulesClass.prototype.findMixinsFast;
      const directChildSurfaceBridges: string[] = [];
      const libraryPath = resolve(process.cwd(), 'library-guarded-mixin-set.jess');
      context.sourceTrees.set(libraryPath, rules([
        vardecl({ name: 'accentColor', value: any('red') }),
        mixin({
          name: any('.configured-guarded-set'),
          params: list([
            any('color', { role: 'property' })
          ]),
          guard: condition([
            condition([
              expr(ref({ key: 'mode' }, { type: 'variable' })),
              '=',
              any('dark')
            ]),
            'and',
            condition([
              expr(ref({ key: 'accentColor' }, { type: 'variable' })),
              '=',
              any('purple')
            ])
          ]),
          rules: rules([
            decl({ name: any('color'), value: ref({ key: 'color' }, { type: 'variable' }) }),
            decl({ name: any('border-color'), value: ref({ key: 'accentColor' }, { type: 'variable' }) })
          ])
        })
      ]));

      const node = rules([
        style({
          path: quoted(any('library-guarded-mixin-set.jess')),
          with: {
            node: rules([
              vardecl({ name: 'accentColor', value: any('purple') })
            ]),
            type: 'set'
          }
        }, {
          type: 'compose',
          namespace: '*'
        }),
        ruleset({
          selector: el('.dark'),
          rules: rules([
            vardecl({ name: 'mode', value: any('dark') }),
            call({
              name: ref({ key: '.configured-guarded-set' }, { type: 'mixin-ruleset' }),
              args: list([any('red')])
            })
          ])
        }),
        ruleset({
          selector: el('.light'),
          rules: rules([
            vardecl({ name: 'mode', value: any('light') }),
            call({
              name: ref({ key: '.configured-guarded-set' }, { type: 'mixin-ruleset' }),
              args: list([any('red')])
            })
          ])
        })
      ]);

      RulesClass.prototype.findMixinsFast = function(...args: Parameters<typeof originalFindMixinsFast>) {
        const [key, options] = args;
        if (key === '.configured-guarded-set' && options?.searchParents === false) {
          directChildSurfaceBridges.push(key);
        }
        return originalFindMixinsFast.apply(this, args);
      };

      try {
        const css = await renderNodeToString(node, context, { context });

        expect(css).toContain('.dark {');
        expect(css).toContain('color: red;');
        expect(css).toContain('border-color: purple;');
        expect(css).not.toContain('.light {\n  color: red;');
        expect(css).not.toContain('border-color: red;');
        expect(directChildSurfaceBridges).toEqual([]);
      } finally {
        RulesClass.prototype.findMixinsFast = originalFindMixinsFast;
      }
    });

    it('keeps variable-only additive "with" configs visible to imported detached ruleset variable closures', async () => {
      const libraryPath = resolve(process.cwd(), 'library-detached-closure-configured.jess');
      context.sourceTrees.set(libraryPath, rules([
        mixin({
          name: any('.use-accent'),
          rules: rules([
            vardecl({
              name: 'accent-content',
              value: rules([
                decl({ name: any('border-color'), value: ref({ key: 'accentColor' }, { type: 'variable' }) })
              ])
            }),
            call({
              name: ref({ key: 'accent-content' }, { type: 'variable' })
            })
          ])
        })
      ]));

      const node = rules([
        style({
          path: quoted(any('library-detached-closure-configured.jess')),
          with: {
            node: rules([
              vardecl({ name: 'accentColor', value: any('purple') })
            ]),
            type: 'with'
          }
        }, {
          type: 'compose',
          namespace: '*'
        }),
        ruleset({
          selector: el('.consumer'),
          rules: rules([
            call({
              name: ref({ key: '.use-accent' }, { type: 'mixin-ruleset' }),
              args: list([])
            })
          ])
        })
      ]);

      const css = await renderNodeToString(node, context, { context });

      expect(css).toContain('.consumer {');
      expect(css).toContain('border-color: purple;');
    });

    it('keeps replacement configs on an imported child rules surface when additive nodes are also present', async () => {
      const originalClone = RulesClass.prototype.clone;
      let clonedLibraryRules = 0;
      RulesClass.prototype.clone = function cloneForCounting(
        this: RulesClass,
        ...args: Parameters<typeof originalClone>
      ): ReturnType<typeof originalClone> {
        if (this.rules.some(node => isNode(node, N.VarDeclaration) && node.name.valueOf() === 'baseColor')) {
          clonedLibraryRules++;
        }
        return originalClone.apply(this, args);
      };
      const libraryPath = resolve(process.cwd(), 'library.jess');
      context.sourceTrees.set(libraryPath, rules([
        vardecl({ name: 'baseColor', value: any('red') }),
        vardecl({ name: 'derivedColor', value: ref('baseColor', { type: 'variable' }) }),
        ruleset({
          selector: sellist([sel([el('.base')])]),
          rules: rules([
            decl({ name: any('color'), value: ref('derivedColor', { type: 'variable' }) })
          ])
        })
      ]));

      const node = rules([
        style({
          path: quoted(any('library.jess')),
          with: {
            node: rules([
              vardecl({ name: 'baseColor', value: any('teal') }),
              ruleset({
                selector: sellist([sel([el('.addon')])]),
                rules: rules([
                  decl({ name: any('border-color'), value: any('teal') })
                ])
              })
            ]),
            type: 'with'
          }
        }, {
          type: 'compose',
          namespace: '*'
        })
      ]);

      try {
        const evald = await node.eval(context);
        const composedRules = evald.at(0) as Rules;
        const importedChildSurface = composedRules.rules.find(child => isNode(child, N.Rules)) as Rules | undefined;
        const css = await renderNodeToString(node, context, { context });

        expect(composedRules.rules.some(child => isNode(child, N.Rules))).toBe(true);
        expect(composedRules.options.importBoundary).toBe(true);
        expect(importedChildSurface?.options.importBoundary).toBeUndefined();
        expect(css).toContain('.base');
        expect(css).toContain('.addon');
        expect(clonedLibraryRules).toBe(0);

        const derivedColor = getVarWithContext(context, composedRules, 'derivedColor');
        expect(derivedColor).toBeDefined();
        const derivedColorValue = await derivedColor!.value.eval(context);
        expect(derivedColorValue.toTrimmedString()).toBe('teal');
      } finally {
        RulesClass.prototype.clone = originalClone;
      }
    });

    it('keeps replacement "set" configs on an imported child rules surface for detached ruleset variable closures', async () => {
      const originalFind = RulesClass.prototype.find;
      const declarationBridgeHits: string[] = [];
      const libraryPath = resolve(process.cwd(), 'library-detached-closure-set-child-surface.jess');
      context.sourceTrees.set(libraryPath, rules([
        vardecl({ name: 'accentColor', value: any('red') }),
        mixin({
          name: any('.use-accent'),
          rules: rules([
            vardecl({
              name: 'accent-content',
              value: rules([
                decl({ name: any('border-color'), value: ref({ key: 'accentColor' }, { type: 'variable' }) })
              ])
            }),
            call({
              name: ref({ key: 'accent-content' }, { type: 'variable' })
            })
          ])
        }),
        ruleset({
          selector: sellist([sel([el('.base')])]),
          rules: rules([
            decl({ name: any('display'), value: any('block') })
          ])
        })
      ]));

      const node = rules([
        style({
          path: quoted(any('library-detached-closure-set-child-surface.jess')),
          with: {
            node: rules([
              vardecl({ name: 'accentColor', value: any('purple') }),
              ruleset({
                selector: sellist([sel([el('.addon')])]),
                rules: rules([
                  decl({ name: any('visibility'), value: any('visible') }),
                  decl({ name: any('setConfiguredProp'), value: any('set-configured') })
                ])
              })
            ]),
            type: 'set'
          }
        }, {
          type: 'compose',
          namespace: '*'
        }),
        vardecl({ name: 'accentColor', value: any('red') }),
        ruleset({
          selector: el('.consumer'),
          rules: rules([
            decl({ name: any('prop-hit'), value: ref('setConfiguredProp', { type: 'property' }) }),
            call({
              name: ref({ key: '.use-accent' }, { type: 'mixin-ruleset' }),
              args: list([])
            })
          ])
        })
      ]);
      RulesClass.prototype.find = function(...args: Parameters<typeof originalFind>) {
        const [type, key, filterType] = args;
        if (type === 'declaration' && key === 'setConfiguredProp') {
          declarationBridgeHits.push(`${filterType}:${key}`);
        }
        return originalFind.apply(this, args);
      };

      try {
        const evald = await node.eval(context);
        const composedRules = evald.at(0) as Rules;
        const importedChildSurface = composedRules.rules.find(child => isNode(child, N.Rules)) as Rules | undefined;
        const css = await renderNodeToString(node, context, { context });

        expect(composedRules.rules.some(child => isNode(child, N.Rules))).toBe(true);
        expect(composedRules.options.importBoundary).toBe(true);
        expect(importedChildSurface?.options.importBoundary).toBeUndefined();
        expect(css).toContain('.base');
        expect(css).toContain('.addon');
        expect(css).toContain('.consumer {');
        expect(css).toContain('prop-hit: set-configured;');
        expect(css).toContain('border-color: purple;');
        expect(css).not.toContain('border-color: red;');
        expect(declarationBridgeHits).toEqual([]);
      } finally {
        RulesClass.prototype.find = originalFind;
      }
    });

    it('keeps replacement "set" configs on an imported child rules surface for guarded mixins', async () => {
      const originalFindMixinsFast = RulesClass.prototype.findMixinsFast;
      const directChildSurfaceBridges: string[] = [];
      const libraryPath = resolve(process.cwd(), 'library-guarded-mixin-set-child-surface.jess');
      context.sourceTrees.set(libraryPath, rules([
        vardecl({ name: 'accentColor', value: any('red') }),
        mixin({
          name: any('.guarded-child-surface-set'),
          params: list([
            any('color', { role: 'property' })
          ]),
          guard: condition([
            condition([
              expr(ref({ key: 'mode' }, { type: 'variable' })),
              '=',
              any('dark')
            ]),
            'and',
            condition([
              expr(ref({ key: 'accentColor' }, { type: 'variable' })),
              '=',
              any('purple')
            ])
          ]),
          rules: rules([
            decl({ name: any('color'), value: ref({ key: 'color' }, { type: 'variable' }) }),
            decl({ name: any('border-color'), value: ref({ key: 'accentColor' }, { type: 'variable' }) })
          ])
        }),
        ruleset({
          selector: sellist([sel([el('.base')])]),
          rules: rules([
            decl({ name: any('display'), value: any('block') })
          ])
        })
      ]));

      const node = rules([
        style({
          path: quoted(any('library-guarded-mixin-set-child-surface.jess')),
          with: {
            node: rules([
              vardecl({ name: 'accentColor', value: any('purple') }),
              ruleset({
                selector: sellist([sel([el('.addon')])]),
                rules: rules([
                  decl({ name: any('visibility'), value: any('visible') })
                ])
              })
            ]),
            type: 'set'
          }
        }, {
          type: 'compose',
          namespace: '*'
        }),
        vardecl({ name: 'accentColor', value: any('red') }),
        ruleset({
          selector: el('.dark'),
          rules: rules([
            vardecl({ name: 'mode', value: any('dark') }),
            call({
              name: ref({ key: '.guarded-child-surface-set' }, { type: 'mixin-ruleset' }),
              args: list([any('red')])
            })
          ])
        }),
        ruleset({
          selector: el('.light'),
          rules: rules([
            vardecl({ name: 'mode', value: any('light') }),
            call({
              name: ref({ key: '.guarded-child-surface-set' }, { type: 'mixin-ruleset' }),
              args: list([any('red')])
            })
          ])
        })
      ]);

      RulesClass.prototype.findMixinsFast = function(...args: Parameters<typeof originalFindMixinsFast>) {
        const [key, options] = args;
        if (key === '.guarded-child-surface-set' && options?.searchParents === false) {
          directChildSurfaceBridges.push(key);
        }
        return originalFindMixinsFast.apply(this, args);
      };

      try {
        const evald = await node.eval(context);
        const composedRules = evald.at(0) as Rules;
        const importedChildSurface = composedRules.rules.find(child => isNode(child, N.Rules)) as Rules | undefined;
        const css = await renderNodeToString(node, context, { context });

        expect(composedRules.rules.some(child => isNode(child, N.Rules))).toBe(true);
        expect(composedRules.options.importBoundary).toBe(true);
        expect(importedChildSurface?.options.importBoundary).toBeUndefined();
        expect(css).toContain('.base');
        expect(css).toContain('.addon');
        expect(css).toContain('.dark {');
        expect(css).toContain('color: red;');
        expect(css).toContain('border-color: purple;');
        expect(css).not.toContain('.light {\n  color: red;');
        expect(css).not.toContain('border-color: red;');
        expect(directChildSurfaceBridges).toEqual([]);
      } finally {
        RulesClass.prototype.findMixinsFast = originalFindMixinsFast;
      }
    });

    it('keeps child-surface additive "with" configs compatible with imported mixin calls', async () => {
      const libraryPath = resolve(process.cwd(), 'library-child-surface-mixin.jess');
      context.sourceTrees.set(libraryPath, rules([
        mixin({
          name: any('.use-accent'),
          rules: rules([
            decl({ name: any('color'), value: ref({ key: 'accentColor' }, { type: 'variable' }) })
          ])
        }),
        ruleset({
          selector: sellist([sel([el('.base')])]),
          rules: rules([
            decl({ name: any('background'), value: any('white') })
          ])
        })
      ]));

      const node = rules([
        style({
          path: quoted(any('library-child-surface-mixin.jess')),
          with: {
            node: rules([
              vardecl({ name: 'accentColor', value: any('purple') }),
              ruleset({
                selector: sellist([sel([el('.addon')])]),
                rules: rules([
                  decl({ name: any('border-color'), value: any('purple') })
                ])
              })
            ]),
            type: 'with'
          }
        }, {
          type: 'compose',
          namespace: '*'
        }),
        ruleset({
          selector: el('.consumer'),
          rules: rules([
            call({
              name: ref({ key: '.use-accent' }, { type: 'mixin-ruleset' }),
              args: list([])
            })
          ])
        })
      ]);

      const evald = await node.eval(context);
      const composedRules = evald.at(0) as Rules;
      const css = await renderNodeToString(node, context, { context });

      expect(composedRules.rules.some(child => isNode(child, N.Rules))).toBe(true);
      expect(css).toContain('.base');
      expect(css).toContain('.addon');
      expect(css).toContain('.consumer {');
      expect(css).toContain('color: purple;');
    });

    it('keeps child-surface additive "with" configs visible to imported guarded mixins', async () => {
      const originalFindMixinsFast = RulesClass.prototype.findMixinsFast;
      const directChildSurfaceBridges: string[] = [];
      const libraryPath = resolve(process.cwd(), 'library-child-surface-guarded-mixin.jess');
      context.sourceTrees.set(libraryPath, rules([
        mixin({
          name: any('.guarded-child-surface'),
          params: list([
            any('color', { role: 'property' })
          ]),
          guard: condition([
            condition([
              expr(ref({ key: 'mode' }, { type: 'variable' })),
              '=',
              any('dark')
            ]),
            'and',
            condition([
              expr(ref({ key: 'accentColor' }, { type: 'variable' })),
              '=',
              any('purple')
            ])
          ]),
          rules: rules([
            decl({ name: any('color'), value: ref({ key: 'color' }, { type: 'variable' }) }),
            decl({ name: any('border-color'), value: ref({ key: 'accentColor' }, { type: 'variable' }) })
          ])
        })
      ]));

      const node = rules([
        style({
          path: quoted(any('library-child-surface-guarded-mixin.jess')),
          with: {
            node: rules([
              vardecl({ name: 'accentColor', value: any('purple') }),
              ruleset({
                selector: sellist([sel([el('.addon')])]),
                rules: rules([
                  decl({ name: any('border-color'), value: any('purple') })
                ])
              })
            ]),
            type: 'with'
          }
        }, {
          type: 'compose',
          namespace: '*'
        }),
        ruleset({
          selector: el('.dark'),
          rules: rules([
            vardecl({ name: 'mode', value: any('dark') }),
            call({
              name: ref({ key: '.guarded-child-surface' }, { type: 'mixin-ruleset' }),
              args: list([any('red')])
            })
          ])
        }),
        ruleset({
          selector: el('.light'),
          rules: rules([
            vardecl({ name: 'mode', value: any('light') }),
            call({
              name: ref({ key: '.guarded-child-surface' }, { type: 'mixin-ruleset' }),
              args: list([any('red')])
            })
          ])
        })
      ]);

      RulesClass.prototype.findMixinsFast = function(...args: Parameters<typeof originalFindMixinsFast>) {
        const [key, options] = args;
        if (key === '.guarded-child-surface' && options?.searchParents === false) {
          directChildSurfaceBridges.push(key);
        }
        return originalFindMixinsFast.apply(this, args);
      };

      try {
        const css = await renderNodeToString(node, context, { context });

        expect(css).toContain('.addon');
        expect(css).toContain('.dark {');
        expect(css).toContain('color: red;');
        expect(css).toContain('border-color: purple;');
        expect(css).not.toContain('.light {\n  color: red;');
        expect(directChildSurfaceBridges).toEqual([]);
      } finally {
        RulesClass.prototype.findMixinsFast = originalFindMixinsFast;
      }
    });

    it('keeps child-surface additive "with" configs visible to imported detached ruleset variable closures', async () => {
      const libraryPath = resolve(process.cwd(), 'library-child-surface-detached-closure.jess');
      context.sourceTrees.set(libraryPath, rules([
        mixin({
          name: any('.use-accent'),
          rules: rules([
            vardecl({
              name: 'accent-content',
              value: rules([
                decl({ name: any('border-color'), value: ref({ key: 'accentColor' }, { type: 'variable' }) })
              ])
            }),
            call({
              name: ref({ key: 'accent-content' }, { type: 'variable' })
            })
          ])
        })
      ]));

      const node = rules([
        style({
          path: quoted(any('library-child-surface-detached-closure.jess')),
          with: {
            node: rules([
              vardecl({ name: 'accentColor', value: any('purple') }),
              ruleset({
                selector: sellist([sel([el('.addon')])]),
                rules: rules([
                  decl({ name: any('display'), value: any('block') })
                ])
              })
            ]),
            type: 'with'
          }
        }, {
          type: 'compose',
          namespace: '*'
        }),
        vardecl({ name: 'accentColor', value: any('red') }),
        ruleset({
          selector: el('.consumer'),
          rules: rules([
            call({
              name: ref({ key: '.use-accent' }, { type: 'mixin-ruleset' }),
              args: list([])
            })
          ])
        })
      ]);

      const css = await renderNodeToString(node, context, { context });

      expect(css).toContain('.addon');
      expect(css).toContain('.consumer {');
      expect(css).toContain('border-color: purple;');
      expect(css).not.toContain('border-color: red;');
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

    it('throws if compose "with" is used after the module is already cached', async () => {
      const libraryPath = resolve(process.cwd(), 'library-compose-with-cache.jess');
      context.sourceTrees.set(libraryPath, rules([
        vardecl({ name: 'var', value: any('value') })
      ]));

      const node1 = rules([
        style({
          path: quoted(any('library-compose-with-cache.jess'))
        }, {
          type: 'compose',
          namespace: '*'
        })
      ]);
      await node1.eval(context);

      const node2 = rules([
        style({
          path: quoted(any('library-compose-with-cache.jess')),
          with: {
            node: rules([
              vardecl({ name: 'var', value: any('second') })
            ]),
            type: 'with'
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
    it('reuses source-free scalar leaves for first-use import-local placement', async () => {
      const originalClone = Any.prototype.clone;
      let clonedRedLeaves = 0;
      Any.prototype.clone = function cloneForCounting(
        this: Any,
        ...args: Parameters<typeof originalClone>
      ): ReturnType<typeof originalClone> {
        if (this.value === 'red' && this.location.length === 0) {
          clonedRedLeaves++;
        }
        return originalClone.apply(this, args);
      };

      try {
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

        const css = await renderNodeToString(node, context);
        expect(css).toContain('color: red;');
        expect(clonedRedLeaves).toBe(0);
      } finally {
        Any.prototype.clone = originalClone;
      }
    });

    it('derives the first-use import-local Rules wrapper without cloning the source root', async () => {
      const originalClone = RulesClass.prototype.clone;
      let clonedImportRoots = 0;
      RulesClass.prototype.clone = function cloneForCounting(
        this: RulesClass,
        ...args: Parameters<typeof originalClone>
      ): ReturnType<typeof originalClone> {
        if (this.rules.some(node => isNode(node, N.Ruleset))) {
          clonedImportRoots++;
        }
        return originalClone.apply(this, args);
      };

      try {
        context.sourceTrees.set('imported-root.jess', rules([
          ruleset({
            selector: sellist([sel([el('.imported-root')])]),
            rules: rules([
              decl({ name: any('color'), value: any('red') })
            ])
          })
        ]));

        const node = rules([
          style({
            path: quoted(any('imported-root.jess'))
          }, {
            type: 'import'
          })
        ]);

        const css = await renderNodeToString(node, context);
        expect(css).toContain('.imported-root');
        expect(clonedImportRoots).toBe(0);
      } finally {
        RulesClass.prototype.clone = originalClone;
      }
    });

    it('keeps cache-stable first-use plain import source children canonical until eval replaces them', async () => {
      const importedRules = rules([
        ruleset({
          selector: sellist([sel([el('.shared-import-child')])]),
          rules: rules([
            decl({ name: any('color'), value: any('red') })
          ])
        })
      ]);
      const sourceChild = importedRules.rules[0];
      context.sourceTrees.set('shared-import-child.jess', importedRules);

      const node = rules([
        style({
          path: quoted(any('shared-import-child.jess'))
        }, {
          type: 'import'
        })
      ]);

      const evald = await node.eval(context);
      const placement = evald.rules[0];
      expect(isNode(placement, N.Rules)).toBe(true);
      if (!isNode(placement, N.Rules)) {
        throw new TypeError('Expected import result to be a Rules placement');
      }
      expect(placement.rules[0]).not.toBe(sourceChild);
      expect(sourceChild?.parent).toBe(importedRules);
    });

    it('keeps first-use source-free scalar declaration imports placement-owned while reusing the scalar leaf', async () => {
      const red = any('red');
      const sourceDecl = decl({ name: any('color'), value: red });
      const importedRules = rules([sourceDecl]);
      context.sourceTrees.set('shared-import-scalar-decl.jess', importedRules);

      const node = rules([
        style({
          path: quoted(any('shared-import-scalar-decl.jess'))
        }, {
          type: 'import'
        })
      ]);

      const evald = await node.eval(context);
      const placement = evald.rules[0];
      expect(isNode(placement, N.Rules)).toBe(true);
      if (!isNode(placement, N.Rules)) {
        throw new TypeError('Expected import result to be a Rules placement');
      }
      const placementDecl = placement.rules[0];
      expect(placementDecl).not.toBe(sourceDecl);
      expect(sourceDecl.parent).toBe(importedRules);
      expect(isNode(placementDecl, N.Declaration)).toBe(true);
      if (!isNode(placementDecl, N.Declaration)) {
        throw new TypeError('Expected placement child to be a declaration');
      }
      expect(placementDecl.value).toBe(red);
      expect(red.parent).toBe(sourceDecl);
    });

    it('keeps nested source-free scalar import placement owned while reusing scalar leaves', async () => {
      const red = any('red');
      const sourceDecl = decl({ name: any('color'), value: red });
      const sourceRuleset = ruleset({
        selector: sellist([sel([el('.nested-import')])]),
        rules: rules([sourceDecl])
      });
      const importedRules = rules([sourceRuleset]);
      context.sourceTrees.set('nested-source-free-scalar.jess', importedRules);

      const node = rules([
        style({
          path: quoted(any('nested-source-free-scalar.jess'))
        }, {
          type: 'import'
        })
      ]);

      const evald = await node.eval(context);
      const placement = evald.rules[0];
      expect(isNode(placement, N.Rules)).toBe(true);
      if (!isNode(placement, N.Rules)) {
        throw new TypeError('Expected import result to be a Rules placement');
      }
      const placementRuleset = placement.rules[0];
      expect(placementRuleset).not.toBe(sourceRuleset);
      expect(sourceRuleset.parent).toBe(importedRules);
      expect(isNode(placementRuleset, N.Ruleset)).toBe(true);
      if (!isNode(placementRuleset, N.Ruleset)) {
        throw new TypeError('Expected placement child to be a ruleset');
      }
      expect(getImportPlacementChildSegments(placement)).toEqual([
        {
          kind: 'source-child',
          source: sourceRuleset,
          output: placementRuleset,
          index: 0
        }
      ]);
      expect(getImportPlacementSourceChild(placement, placementRuleset)).toBe(sourceRuleset);
      expect(getImportPlacementSegmentSourceChild(placement, placementRuleset)).toBe(sourceRuleset);
      const placementDecl = placementRuleset.rules?.rules[0];
      expect(placementDecl).not.toBe(sourceDecl);
      expect(isNode(placementDecl, N.Declaration)).toBe(true);
      if (!isNode(placementDecl, N.Declaration)) {
        throw new TypeError('Expected nested placement declaration');
      }
      expect(getImportPlacementSourceChild(placement, placementDecl)).toBe(sourceDecl);
      expect(getImportPlacementSegmentSourceChild(placement, placementDecl)).toBe(sourceDecl);
      expect(getImportPlacementSourceChild(placement, red)).toBe(red);
      expect(getImportPlacementSegmentSourceChild(placement, red)).toBe(red);
      expect(placementDecl.value).toBe(red);
      expect(red.parent).toBe(sourceDecl);
    });

    it('keeps cache-hit reference visibility isolated from the cached import source', async () => {
      const importedRules = rules([
        ruleset({
          selector: sellist([sel([el('.cached-reference')])]),
          rules: rules([
            decl({ name: any('color'), value: any('red') })
          ])
        })
      ]);
      context.sourceTrees.set('cached-reference.jess', importedRules);

      const firstEval = await rules([
        style({
          path: quoted(any('cached-reference.jess'))
        }, {
          type: 'import'
        })
      ]).eval(context);
      const secondEval = await rules([
        style({
          path: quoted(any('cached-reference.jess'))
        }, {
          type: 'import',
          importOptions: {
            reference: true
          }
        })
      ]).eval(context);

      expect(firstEval.rules[0]).not.toBe(importedRules);
      const referencePlacement = secondEval.rules[0];
      expect(isNode(referencePlacement, N.Rules)).toBe(true);
      if (!isNode(referencePlacement, N.Rules)) {
        throw new TypeError('Expected reference import placement');
      }
      expect(referencePlacement.options.referenceMode).toBe(true);
      expect(getImportPlacementReferenceMode(referencePlacement)).toBe(true);
      expect(referencePlacement.options.rulesVisibility.Ruleset).toBe('optional');
      expect(getImportPlacementRulesVisibility(referencePlacement)?.Ruleset).toBe('optional');
      expect(importedRules.options.referenceMode).not.toBe(true);
      expect(importedRules.options.rulesVisibility.Ruleset).toBe('public');

      delete referencePlacement.options.referenceMode;
      delete referencePlacement.options.rulesVisibility;
      expect(getImportPlacementReferenceMode(referencePlacement)).toBe(true);
      expect(getImportPlacementRulesVisibility(referencePlacement)?.Ruleset).toBe('optional');
      expect(getImportPlacementRenderState(referencePlacement)).toEqual({
        referenceMode: true,
        rulesVisibility: getImportPlacementRulesVisibility(referencePlacement)
      });
    });

    it('records postlude wrapper order beside nested import placement output', async () => {
      context.sourceTrees.set('postlude-order.jess', rules([
        ruleset({
          selector: sellist([sel([el('.imported')])]),
          rules: rules([
            decl({ name: any('color'), value: any('red') })
          ])
        })
      ]));

      const node = rules([
        style({
          path: quoted(any('postlude-order.jess'))
        }, {
          type: 'import',
          importOptions: {
            multiple: true,
            postlude: list([
              call({ name: 'layer', args: list([any('components')]) }),
              call({ name: 'media', args: list([any('screen')]) })
            ])
          }
        })
      ]);

      const evald = await node.eval(context);
      const wrapped = evald.rules[0];
      expect(isNode(wrapped, N.Rules)).toBe(true);
      if (!isNode(wrapped, N.Rules)) {
        throw new TypeError('Expected postlude Rules wrapper');
      }
      const placement = getImportPostludePlacement(wrapped);
      expect(placement?.postludeNames).toEqual(['@layer', '@media']);
      expect(getImportPostludeRenderOrder(wrapped)).toEqual(['@layer', '@media']);
      expect(getImportPostludeRenderState(wrapped)).toEqual({
        order: ['@layer', '@media'],
        sourceRules: placement?.sourceRules,
        outputRules: wrapped
      });
      expect(placement?.outputRules).toBe(wrapped);
      expect(isNode(placement?.sourceRules.rules[0], N.Ruleset)).toBe(true);
      expect(isNode(wrapped.rules[0], N.AtRule)).toBe(true);
      expect(await evald.render(context)).toContain('@layer components');
    });

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
      expect(evald.rules.length).toBe(2);
    });
  });

  describe('less import fixture regressions', () => {
    it('keeps non-declaration pending identity prep source-ordered', async () => {
      const order: string[] = [];
      const recordRegistrationPrep = (node: Node, label: string): void => {
        const original = node.prepareRegistration.bind(node);
        node.prepareRegistration = (ctx: Context) => {
          order.push(label);
          return original(ctx);
        };
      };

      const dynamicMixin = mixin({
        name: new Interpolated({
          source: '.' + INTERPOLATION_PLACEHOLDER,
          replacements: [any('pending-mixin')]
        }, { role: 'name' }),
        rules: rules([decl({ name: 'color', value: any('orange') })])
      });
      const dynamicImport = style({
        path: quoted(new Interpolated({
          source: 'missing-' + INTERPOLATION_PLACEHOLDER + '.jess',
          replacements: [any('optional')]
        }, { role: 'ident' }))
      }, { type: 'import', importOptions: { optional: true } });
      const dynamicRuleset = ruleset({
        selector: interpolatedSelector(new Interpolated({
          source: '.' + INTERPOLATION_PLACEHOLDER,
          replacements: [any('pending-ruleset')]
        }, { role: 'ident' })),
        rules: rules([decl({ name: 'color', value: any('red') })])
      });

      recordRegistrationPrep(dynamicMixin, 'callable');
      recordRegistrationPrep(dynamicImport, 'import');
      recordRegistrationPrep(dynamicRuleset, 'selector');

      await rules([
        dynamicMixin,
        dynamicImport,
        dynamicRuleset
      ]).eval(context);

      expect(order.slice(0, 3)).toEqual(['callable', 'import', 'selector']);
    });

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
      const wrappedImport = evald.at(0);
      expect(wrappedImport).toBeInstanceOf(RulesClass);
      if (!(wrappedImport instanceof RulesClass)) {
        throw new Error('Expected inline wrapped import to be Rules');
      }
      expect(wrappedImport.rules).toHaveLength(1);
      expect(isNode(wrappedImport.rules[0], N.AtRule)).toBe(true);
      const css = await renderNodeToString(node, inlineContext, { context: inlineContext });
      expect(css).toContain('@media (min-width: 600px)');
      expect(css).toContain('#css { color: yellow; }');

      const writer = new OutputWriter();
      wrappedImport.toString(getPrintOptions({ writer, context: inlineContext }));
      const map = buildSourceMap(writer, {
        file: 'out.css',
        sourcesContent: new Map([[inlinePath, '#css { color: yellow; }\n']])
      });
      expect(map.sources).toContain(inlinePath);
      expect(map.sourcesContent).toContain('#css { color: yellow; }\n');
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
      ], { sep: ' ' });

      const node = rules([
        style({ path: quoted(any('inline-postlude.css')) }, {
          type: 'import',
          importOptions: {
            inline: true,
            postlude
          }
        })
      ]);

      const evald = await node.eval(inlineContext);
      const wrappedImport = evald.at(0);
      expect(wrappedImport).toBeInstanceOf(RulesClass);
      if (!(wrappedImport instanceof RulesClass)) {
        throw new Error('Expected inline wrapped import to be Rules');
      }
      expect(isNode(wrappedImport.rules[0], N.AtRule)).toBe(true);
      if (!isNode(wrappedImport.rules[0], N.AtRule)) {
        throw new Error('Expected inline wrapped import child to be AtRule');
      }
      expect(wrappedImport.rules[0].name.toTrimmedString()).toBe('@layer');
      const supportsRules = wrappedImport.rules[0].rules;
      expect(supportsRules).toBeInstanceOf(RulesClass);
      if (!(supportsRules instanceof RulesClass)) {
        throw new Error('Expected @layer rules to be wrapped in Rules');
      }
      expect(isNode(supportsRules.rules[0], N.AtRule)).toBe(true);
      if (!isNode(supportsRules.rules[0], N.AtRule)) {
        throw new Error('Expected @layer child to be AtRule');
      }
      expect(supportsRules.rules[0].name.toTrimmedString()).toBe('@supports');
      const mediaRules = supportsRules.rules[0].rules;
      expect(mediaRules).toBeInstanceOf(RulesClass);
      if (!(mediaRules instanceof RulesClass)) {
        throw new Error('Expected @supports rules to be wrapped in Rules');
      }
      expect(isNode(mediaRules.rules[0], N.AtRule)).toBe(true);
      if (!isNode(mediaRules.rules[0], N.AtRule)) {
        throw new Error('Expected @supports child to be AtRule');
      }
      expect(mediaRules.rules[0].name.toTrimmedString()).toBe('@media');

      const css = await renderNodeToString(node, inlineContext, { context: inlineContext });
      expect(css).toContain('@layer theme');
      expect(css).toContain('@supports (display: grid)');
      expect(css).toContain('@media screen and (min-width: 600px)');
      expect(css).toContain('#css { color: yellow; }');
    });

    it('derives evaluated import postlude wrappers from imported rules', async () => {
      const importedPath = resolve(process.cwd(), 'import/postlude-derived.jess');
      context.sourceTrees.set(importedPath, rules([
        ruleset({
          selector: sellist([sel([el('.imported')])]),
          rules: rules([
            decl({ name: any('color'), value: any('red') })
          ])
        })
      ]));

      const node = rules([
        style({ path: quoted(any('import/postlude-derived.jess')) }, {
          type: 'import',
          importOptions: {
            postlude: any('screen and (min-width: 600px)')
          }
        })
      ]);

      const evald = await node.eval(context);
      const wrappedImport = evald.at(0);

      expect(wrappedImport).toBeInstanceOf(RulesClass);
      if (!(wrappedImport instanceof RulesClass)) {
        throw new Error('Expected wrapped import to be Rules');
      }
      expect(wrappedImport).not.toBe(context.sourceTrees.get(importedPath));
      expect(wrappedImport.rules).toHaveLength(1);
      expect(isNode(wrappedImport.rules[0], N.AtRule)).toBe(true);
      if (!isNode(wrappedImport.rules[0], N.AtRule)) {
        throw new Error('Expected wrapped import child to be AtRule');
      }
      expect(Array.isArray(wrappedImport.rules[0].rules)).toBe(true);
      const css = await renderNodeToString(node, context, { context });
      expect(css).toContain('@media screen and (min-width: 600px)');
      expect(css).toContain('.imported');
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
      expect(resolvedFromInterpolatedImport.toTrimmedString()).toBe('$interpolationResolved: ok');
    });

    it('import-interpolation: reclassifies interpolated .css imports as literal CSS @import', async () => {
      const interpolatedPath = new Interpolated({
        source: `${INTERPOLATION_PLACEHOLDER}${INTERPOLATION_PLACEHOLDER}`,
        replacements: [any('file'), any('.css')]
      }, { role: 'ident' });

      const node = rules([
        style({ path: quoted(interpolatedPath) }, { type: 'import', importOptions: { optional: false } }),
        ruleset({
          selector: sellist([sel([el('.after')])]),
          rules: rules([decl({ name: any('color'), value: any('red') })])
        })
      ]);

      const css = await renderNodeToString(node, context, { context });
      expect(css).toContain('@import "file.css";');
      expect(css).toContain('.after {');
      expect(css.indexOf('@import "file.css";')).toBeLessThan(css.indexOf('.after {'));
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
      const css = await renderNodeToString(node, context);
      expect(css.split('.once').length - 1).toBe(1);
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
      expect(resolved.toTrimmedString()).toBe('value: 42');
    });

    it('import-reference: reference-imported vars remain readable inside later nested rulesets', async () => {
      const referencedPath = resolve(process.cwd(), 'reference-nested.jess');
      context.sourceTrees.set(referencedPath, rules([
        vardecl({ name: 'fromRef', value: any('42') })
      ]));
      const node = rules([
        style({ path: quoted(any('reference-nested.jess')) }, { type: 'import', importOptions: { reference: true } }),
        ruleset({
          selector: sellist([sel([el('.test')])]),
          rules: rules([
            decl({ name: any('value'), value: ref('fromRef', { type: 'variable' }) })
          ])
        })
      ]);
      const evald = await node.eval(context);
      const rulesetNode = evald.at(1) as any;
      const declaration = rulesetNode.rules.at(0);
      const resolved = await declaration.eval(context);
      expect(resolved.toTrimmedString()).toBe('value: 42');
    });

    it('import-reference: real hit and miss refs avoid public declaration bridges', async () => {
      const referencedPath = resolve(process.cwd(), 'reference-hit-miss.jess');
      const sourceValue = any('42');
      const propertySourceValue = any('24');
      const fallbackValue = any('fallback');
      context.sourceTrees.set(referencedPath, rules([
        vardecl({ name: 'fromRef', value: sourceValue }),
        decl({ name: any('fromRefProp'), value: propertySourceValue }),
        ruleset({
          selector: sellist([sel([el('.ref-prop-a')]), sel([el('.ref-prop-b')])]),
          rules: rules([
            decl({ name: any('fromSelectorListProp'), value: any('36') }),
            ruleset({
              selector: sellist([sel([el('.nested-ref-prop')])]),
              rules: rules([
                decl({ name: any('fromNestedImportedProp'), value: any('48') })
              ])
            })
          ])
        })
      ]));
      const node = rules([
        style({ path: quoted(any('reference-hit-miss.jess')) }, { type: 'import', importOptions: { reference: true } }),
        ruleset({
          selector: sellist([sel([el('.test')])]),
          rules: rules([
            decl({ name: any('hit'), value: ref('fromRef', { type: 'variable' }) }),
            decl({ name: any('miss'), value: ref('missingFromRef', {
              type: 'variable',
              fallbackValue
            }) }),
            decl({ name: any('prop-hit'), value: ref('fromRefProp', { type: 'property' }) }),
            decl({ name: any('selector-list-prop-hit'), value: ref('fromSelectorListProp', { type: 'property' }) }),
            decl({ name: any('nested-imported-prop-hit'), value: ref('fromNestedImportedProp', { type: 'property' }) }),
            decl({ name: any('prop-miss'), value: ref('missingFromRefProp', {
              type: 'property',
              fallbackValue
            }) })
          ])
        })
      ]);
      const originalCopy = Any.prototype.cloneForPlacement;
      const originalFind = RulesClass.prototype.find;
      let scalarCopies = 0;
      const declarationBridgeHits: string[] = [];
      Any.prototype.cloneForPlacement = function(...args: Parameters<typeof originalCopy>) {
        if (
          this === sourceValue
          || this === propertySourceValue
          || this === fallbackValue
        ) {
          scalarCopies++;
        }
        return originalCopy.apply(this, args);
      };
      RulesClass.prototype.find = function(...args: Parameters<typeof originalFind>) {
        const [type, key, filterType] = args;
        if (
          type === 'declaration'
          && (
            key === 'fromRef'
            || key === 'fromRefProp'
            || key === 'fromSelectorListProp'
            || key === 'fromNestedImportedProp'
            || key === 'missingFromRef'
            || key === 'missingFromRefProp'
          )
        ) {
          declarationBridgeHits.push(`${filterType}:${key}`);
        }
        return originalFind.apply(this, args);
      };

      try {
        const evald = await node.eval(context);
        expect(findPropertyDeclarationOccurrence(evald, 'fromRefProp', {
          context,
          searchParents: false
        })?.node.value.valueOf()).toBe('24');
        expect(findPropertyDeclarationOccurrence(evald, 'missingFromRefProp', {
          context,
          searchParents: false
        })).toBeUndefined();
        const css = await renderNodeToString(node, context);

        expect(css).toBeString(`
          .test {
            hit: 42;
            miss: fallback;
            prop-hit: 24;
            selector-list-prop-hit: 36;
            nested-imported-prop-hit: 48;
            prop-miss: fallback;
          }
        `);
        expect(scalarCopies).toBe(0);
        expect(declarationBridgeHits).toEqual([]);
      } finally {
        Any.prototype.cloneForPlacement = originalCopy;
        RulesClass.prototype.find = originalFind;
      }
    });

    it('import-reference: reference-imported mixins remain callable', async () => {
      const referencedPath = resolve(process.cwd(), 'reference-mixin.jess');
      context.sourceTrees.set(referencedPath, rules([
        mixin({
          name: any('.mixin-with-directives'),
          params: list([any('name', { role: 'property' })]),
          rules: rules([
            decl({ name: any('color'), value: any('red') })
          ])
        })
      ]));

      const node = rules([
        style({ path: quoted(any('reference-mixin.jess')) }, { type: 'import', importOptions: { reference: true } }),
        ruleset({
          selector: el('.out'),
          rules: rules([
            call({
              name: ref({ key: '.mixin-with-directives' }, { type: 'mixin-ruleset' }),
              args: list([any('some-name')])
            })
          ])
        })
      ]);

      const css = await renderNodeToString(node, context, { context });
      expect(css).toBeString(`
        .out {
          color: red;
        }
      `);
    });

    it('import-reference: rendered callable misses avoid no-frame direct-crawl bridge', async () => {
      const referencedPath = resolve(process.cwd(), 'reference-callable-miss.jess');
      context.sourceTrees.set(referencedPath, rules([
        mixin({
          name: any('.actual-reference-mixin'),
          rules: rules([
            decl({ name: any('color'), value: any('red') })
          ])
        })
      ]));
      const node = rules([
        style({ path: quoted(any('reference-callable-miss.jess')) }, { type: 'import', importOptions: { reference: true } }),
        ruleset({
          selector: el('.out'),
          rules: rules([
            decl({
              name: any('missing'),
              value: ref({ key: '.missing-reference-mixin' }, {
                type: 'mixin',
                fallbackValue: true
              })
            })
          ])
        })
      ]);
      const originalFindMixinsFast = RulesClass.prototype.findMixinsFast;
      const directCrawlHits: string[] = [];
      RulesClass.prototype.findMixinsFast = function(...args: Parameters<typeof originalFindMixinsFast>) {
        const [key] = args;
        if (key === '.missing-reference-mixin') {
          directCrawlHits.push(key);
        }
        return originalFindMixinsFast.apply(this, args);
      };

      try {
        node.getScopeFrame();
        const css = await renderNodeToString(node, context, { context });

        expect(css).toBeString(`
          .out {
            missing: .missing-reference-mixin;
          }
        `);
        expect(directCrawlHits).toEqual([]);
      } finally {
        RulesClass.prototype.findMixinsFast = originalFindMixinsFast;
      }
    });

    it('import-reference: reference-imported mixins preserve detached ruleset variable closures', async () => {
      const referencedPath = resolve(process.cwd(), 'reference-detached-closure.jess');
      context.sourceTrees.set(referencedPath, rules([
        mixin({
          name: any('.use-theme'),
          params: list([
            any('background', { role: 'property' })
          ]),
          rules: rules([
            vardecl({ name: 'hover-background', value: ref({ key: 'background' }, { type: 'variable' }) }),
            vardecl({
              name: 'hover-content',
              value: rules([
                decl({ name: any('background-color'), value: ref({ key: 'hover-background' }, { type: 'variable' }) })
              ])
            }),
            call({
              name: ref({ key: 'hover-content' }, { type: 'variable' })
            })
          ])
        })
      ]));

      const node = rules([
        style({ path: quoted(any('reference-detached-closure.jess')) }, { type: 'import', importOptions: { reference: true } }),
        ruleset({
          selector: el('.consumer'),
          rules: rules([
            call({
              name: ref({ key: '.use-theme' }, { type: 'mixin-ruleset' }),
              args: list([any('blue')])
            })
          ])
        })
      ]);

      const css = await renderNodeToString(node, context, { context });

      expect(css).toContain('.consumer {');
      expect(css).toContain('background-color: blue;');
    });

    it('import-reference: reference-imported detached ruleset variable closures prefer imported local vars over caller globals', async () => {
      const referencedPath = resolve(process.cwd(), 'reference-detached-shadowing.jess');
      context.sourceTrees.set(referencedPath, rules([
        mixin({
          name: any('.use-theme'),
          params: list([
            any('background', { role: 'property' })
          ]),
          rules: rules([
            vardecl({ name: 'hover-background', value: ref({ key: 'background' }, { type: 'variable' }) }),
            vardecl({
              name: 'hover-content',
              value: rules([
                decl({ name: any('background-color'), value: ref({ key: 'hover-background' }, { type: 'variable' }) })
              ])
            }),
            call({
              name: ref({ key: 'hover-content' }, { type: 'variable' })
            })
          ])
        })
      ]));

      const node = rules([
        vardecl({ name: 'hover-background', value: any('red') }),
        style({ path: quoted(any('reference-detached-shadowing.jess')) }, { type: 'import', importOptions: { reference: true } }),
        ruleset({
          selector: el('.consumer'),
          rules: rules([
            call({
              name: ref({ key: '.use-theme' }, { type: 'mixin-ruleset' }),
              args: list([any('blue')])
            })
          ])
        })
      ]);

      const css = await renderNodeToString(node, context, { context });

      expect(css).toContain('.consumer {');
      expect(css).toContain('background-color: blue;');
      expect(css).not.toContain('background-color: red;');
    });

    it('import-reference: reference-imported mixin guards read caller scope while params stay live-bound', async () => {
      const originalFindMixinsFast = RulesClass.prototype.findMixinsFast;
      const directCrawlHits: string[] = [];
      const referencedPath = resolve(process.cwd(), 'reference-mixin-guarded.jess');
      context.sourceTrees.set(referencedPath, rules([
        mixin({
          name: any('.guarded-ref'),
          params: list([
            any('color', { role: 'property' })
          ]),
          guard: condition([
            condition([
              expr(ref({ key: 'mode' }, { type: 'variable' })),
              '=',
              any('dark')
            ]),
            'and',
            condition([
              expr(ref({ key: 'color' }, { type: 'variable' })),
              '=',
              any('red')
            ])
          ]),
          rules: rules([
            decl({ name: any('color'), value: ref({ key: 'color' }, { type: 'variable' }) })
          ])
        })
      ]));

      const node = rules([
        style({ path: quoted(any('reference-mixin-guarded.jess')) }, { type: 'import', importOptions: { reference: true } }),
        ruleset({
          selector: el('.dark'),
          rules: rules([
            vardecl({ name: 'mode', value: any('dark') }),
            call({
              name: ref({ key: '.guarded-ref' }, { type: 'mixin-ruleset' }),
              args: list([any('red')])
            })
          ])
        }),
        ruleset({
          selector: el('.light'),
          rules: rules([
            vardecl({ name: 'mode', value: any('light') }),
            call({
              name: ref({ key: '.guarded-ref' }, { type: 'mixin-ruleset' }),
              args: list([any('red')])
            }),
            decl({
              name: any('missing'),
              value: ref({ key: '.guarded-ref' }, {
                type: 'mixin',
                fallbackValue: true
              })
            })
          ])
        })
      ]);

      RulesClass.prototype.findMixinsFast = function(...args: Parameters<typeof originalFindMixinsFast>) {
        const [key] = args;
        if (key === '.guarded-ref') {
          directCrawlHits.push(key);
        }
        return originalFindMixinsFast.apply(this, args);
      };

      try {
        const css = await renderNodeToString(node, context, { context });

        expect(css).toContain('.dark {');
        expect(css).toContain('color: red;');
        expect(css).not.toContain('.light {\n  color: red;');
        expect(css).toContain('missing: .guarded-ref(color)');
        expect(directCrawlHits).toEqual([]);
      } finally {
        RulesClass.prototype.findMixinsFast = originalFindMixinsFast;
      }
    });

    it('import-reference: reference-imported default guards read caller scope without leaking param bindings', async () => {
      const originalFindMixinsFast = RulesClass.prototype.findMixinsFast;
      const directCrawlHits: string[] = [];
      const referencedPath = resolve(process.cwd(), 'reference-mixin-default-guarded.jess');
      context.sourceTrees.set(referencedPath, rules([
        mixin({
          name: any('.guarded-default-ref'),
          params: list([
            any('color', { role: 'property' })
          ]),
          guard: condition([
            condition([
              expr(ref({ key: 'mode' }, { type: 'variable' })),
              '=',
              any('dark')
            ]),
            'and',
            defaultguard()
          ]),
          rules: rules([
            decl({ name: any('color'), value: ref({ key: 'color' }, { type: 'variable' }) })
          ])
        }),
        mixin({
          name: any('.guarded-default-ref'),
          params: list([
            any('color', { role: 'property' })
          ]),
          guard: condition([
            condition([
              expr(ref({ key: 'mode' }, { type: 'variable' })),
              '=',
              any('light')
            ]),
            'and',
            defaultguard()
          ]),
          rules: rules([
            decl({ name: any('background'), value: ref({ key: 'color' }, { type: 'variable' }) })
          ])
        })
      ]));

      const node = rules([
        style({ path: quoted(any('reference-mixin-default-guarded.jess')) }, { type: 'import', importOptions: { reference: true } }),
        ruleset({
          selector: el('.dark'),
          rules: rules([
            vardecl({ name: 'mode', value: any('dark') }),
            vardecl({ name: 'color', value: any('outer-dark') }),
            call({
              name: ref({ key: '.guarded-default-ref' }, { type: 'mixin-ruleset' }),
              args: list([any('red')])
            }),
            decl({ name: any('value'), value: ref({ key: 'color' }, { type: 'variable' }) })
          ])
        }),
        ruleset({
          selector: el('.light'),
          rules: rules([
            vardecl({ name: 'mode', value: any('light') }),
            vardecl({ name: 'color', value: any('outer-light') }),
            call({
              name: ref({ key: '.guarded-default-ref' }, { type: 'mixin-ruleset' }),
              args: list([any('blue')])
            }),
            decl({
              name: any('missing'),
              value: ref({ key: '.guarded-default-ref' }, {
                type: 'mixin',
                fallbackValue: true
              })
            }),
            decl({ name: any('value'), value: ref({ key: 'color' }, { type: 'variable' }) })
          ])
        })
      ]);

      RulesClass.prototype.findMixinsFast = function(...args: Parameters<typeof originalFindMixinsFast>) {
        const [key] = args;
        if (key === '.guarded-default-ref') {
          directCrawlHits.push(key);
        }
        return originalFindMixinsFast.apply(this, args);
      };

      try {
        const css = await renderNodeToString(node, context, { context });

        expect(css).toContain('.dark {');
        expect(css).toContain('color: red;');
        expect(css).toContain('value: outer-dark;');
        expect(css).toContain('.light {');
        expect(css).toContain('background: blue;');
        expect(css).toContain('value: outer-light;');
        expect(css).not.toContain('value: red;');
        expect(css).not.toContain('value: blue;');
        expect(css).toContain('missing: .guarded-default-ref(color)');
        expect(directCrawlHits).toEqual([]);
      } finally {
        RulesClass.prototype.findMixinsFast = originalFindMixinsFast;
      }
    });

    it('import-reference: directive-bearing reference-imported mixins remain callable', async () => {
      const referencedPath = resolve(process.cwd(), 'reference-mixin-directives.jess');
      context.sourceTrees.set(referencedPath, rules([
        mixin({
          name: any('.mixin-with-directives'),
          params: list([any('keyframeName', { role: 'property' })]),
          rules: rules([
            atrule({
              name: any('@keyframes'),
              prelude: ref({ key: 'keyframeName' }, { type: 'variable' }),
              rules: rules([
                decl({ name: any('property'), value: any('value') })
              ])
            }),
            vardecl({
              name: 'rules1',
              value: rules([
                decl({ name: any('property'), value: any('value') })
              ])
            })
          ])
        })
      ]));

      const node = rules([
        style({ path: quoted(any('reference-mixin-directives.jess')) }, { type: 'import', importOptions: { reference: true } }),
        ruleset({
          selector: el('.out'),
          rules: rules([
            call({
              name: ref({ key: '.mixin-with-directives' }, { type: 'mixin-ruleset' }),
              args: list([any('some-name')])
            })
          ])
        })
      ]);

      const css = await renderNodeToString(node, context, { context });
      expect(css).toContain('@keyframes some-name');
    });

    it('import-reference: reference-imported mixins still hoist nested media output', async () => {
      context.opts.collapseNesting = true;
      const referencedPath = resolve(process.cwd(), 'reference-mixin-media.jess');
      context.sourceTrees.set(referencedPath, rules([
        mixin({
          name: any('.mixin-with-mediaq'),
          params: list([any('num', { role: 'property' })]),
          rules: rules([
            decl({ name: any('color'), value: any('green') }),
            decl({ name: any('test'), value: ref({ key: 'num' }, { type: 'variable' }) }),
            atrule({
              name: any('@media'),
              prelude: any('(max-size: 450px)'),
              rules: rules([
                decl({ name: any('color'), value: any('red') })
              ])
            })
          ])
        })
      ]));

      const node = rules([
        style({ path: quoted(any('reference-mixin-media.jess')) }, { type: 'import', importOptions: { reference: true } }),
        ruleset({
          selector: el('.out'),
          rules: rules([
            call({
              name: ref({ key: '.mixin-with-mediaq' }, { type: 'mixin-ruleset' }),
              args: list([any('340px')])
            })
          ])
        }),
        ruleset({
          selector: el('.after'),
          rules: rules([
            decl({ name: any('color'), value: any('blue') })
          ])
        })
      ]);

      const css = await renderNodeToString(node, context, { context });
      expect(css).toBeString(`
        .out {
          color: green;
          test: 340px;
        }
        @media (max-size: 450px) {
          .out {
            color: red;
          }
        }
        .after {
          color: blue;
        }
      `);
    });

    it('import-reference: reference-imported mixins keep nested reference imports suppressed', async () => {
      const nestedReferencedPath = resolve(process.cwd(), 'reference-mixin-inner-reference.jess');
      const outerReferencedPath = resolve(process.cwd(), 'reference-mixin-with-inner-reference.jess');
      context.sourceTrees.set(nestedReferencedPath, rules([
        ruleset({
          selector: sellist([sel([el('.hidden-from-inner-reference')])]),
          rules: rules([
            decl({ name: any('display'), value: any('none') })
          ])
        })
      ]));
      context.sourceTrees.set(outerReferencedPath, rules([
        mixin({
          name: any('.outer-reference-mixin'),
          rules: rules([
            decl({ name: any('color'), value: any('red') }),
            style({
              path: quoted(any('reference-mixin-inner-reference.jess'))
            }, {
              type: 'import',
              importOptions: { reference: true }
            })
          ])
        })
      ]));

      const node = rules([
        style({ path: quoted(any('reference-mixin-with-inner-reference.jess')) }, { type: 'import', importOptions: { reference: true } }),
        ruleset({
          selector: el('.consumer'),
          rules: rules([
            call({
              name: ref({ key: '.outer-reference-mixin' }, { type: 'mixin-ruleset' }),
              args: list([])
            })
          ])
        })
      ]);

      const css = await renderNodeToString(node, context, { context });

      expect(css).toContain('.consumer {');
      expect(css).toContain('color: red;');
      expect(css).not.toContain('.hidden-from-inner-reference');
      expect(css).not.toContain('display: none;');
    });

    it('import-reference: namespaced reference-imported rulesets remain callable as mixins', async () => {
      const referencedPath = resolve(process.cwd(), 'simple-mixin.jess');
      context.sourceTrees.set(referencedPath, rules([
        ruleset({
          selector: el('.mixin'),
          rules: rules([
            decl({ name: any('was'), value: any('included') })
          ])
        })
      ]));

      const node = rules([
        ruleset({
          selector: el('#Namespace'),
          rules: rules([
            style({ path: quoted(any('simple-mixin.jess')) }, { type: 'import', importOptions: { reference: true } })
          ])
        }),
        ruleset({
          selector: el('#used-namespaced-mixin'),
          rules: rules([
            call({
              name: ref({
                target: ref({ key: '#Namespace' }, { type: 'mixin-ruleset' }),
                key: '.mixin'
              }, { type: 'mixin-ruleset' })
            })
          ])
        })
      ]);

      const css = await renderNodeToString(node, context, { context });
      expect(css).toBeString(`
        #used-namespaced-mixin {
          was: included;
        }
      `);
    });

    it('import-reference: namespaced reference-imported rulesets remain callable via array-path keys', async () => {
      const referencedPath = resolve(process.cwd(), 'simple-mixin-array.jess');
      context.sourceTrees.set(referencedPath, rules([
        ruleset({
          selector: el('.mixin'),
          rules: rules([
            decl({ name: any('was'), value: any('included') })
          ])
        })
      ]));

      const node = rules([
        ruleset({
          selector: el('#Namespace'),
          rules: rules([
            style({ path: quoted(any('simple-mixin-array.jess')) }, { type: 'import', importOptions: { reference: true } })
          ])
        }),
        ruleset({
          selector: el('#used-namespaced-mixin'),
          rules: rules([
            call({
              name: ref({ key: ['#Namespace', '.mixin'] }, { type: 'mixin-ruleset' })
            })
          ])
        })
      ]);

      const css = await renderNodeToString(node, context, { context });
      expect(css).toBeString(`
        #used-namespaced-mixin {
          was: included;
        }
      `);
    });

    it('import-reference: namespaced reference-imported ruleset array-path lookups', async () => {
      const referencedPath = resolve(process.cwd(), 'simple-mixin-array-fast.jess');
      context.sourceTrees.set(referencedPath, rules([
        ruleset({
          selector: el('.mixin'),
          rules: rules([
            decl({ name: any('was'), value: any('included') })
          ])
        })
      ]));

      const node = rules([
        ruleset({
          selector: el('#Namespace'),
          rules: rules([
            style({ path: quoted(any('simple-mixin-array-fast.jess')) }, { type: 'import', importOptions: { reference: true } })
          ])
        }),
        ruleset({
          selector: el('#used-namespaced-mixin'),
          rules: rules([
            call({
              name: ref({ key: ['#Namespace', '.mixin'] }, { type: 'mixin-ruleset' })
            })
          ])
        })
      ]);
      const directCrawlHits: string[] = [];
      let directBucketReadCount = 0;
      const nestedArrayPathCalls: unknown[] = [];
      const originalFindMixinsFast = RulesClass.prototype.findMixinsFast;
      const originalFindMixin = RulesClass.prototype.findMixin;
      const runtimeRulesPrototype = RulesClass.prototype as typeof RulesClass.prototype & Record<
        'getCallableEntriesForKey',
        (key: string, updateFrameMissCoverage?: boolean) => ReturnType<typeof RulesClass.prototype.findMixinsFast>
      >;
      const originalGetCallableEntriesForKey = runtimeRulesPrototype.getCallableEntriesForKey;
      RulesClass.prototype.findMixinsFast = function(...args: Parameters<typeof originalFindMixinsFast>) {
        const [key] = args;
        if (key === '#Namespace' || key === '.mixin') {
          directCrawlHits.push(key);
        }
        return originalFindMixinsFast.apply(this, args);
      };
      runtimeRulesPrototype.getCallableEntriesForKey = function(
        this: InstanceType<typeof RulesClass>,
        ...args: Parameters<typeof originalGetCallableEntriesForKey>
      ) {
        const [key, updateFrameMissCoverage] = args;
        if (this === node && key === '#Namespace' && updateFrameMissCoverage !== false) {
          directBucketReadCount++;
        }
        return originalGetCallableEntriesForKey.apply(this, args);
      };
      RulesClass.prototype.findMixin = function(...args: Parameters<typeof originalFindMixin>) {
        if (this !== node && Array.isArray(args[0])) {
          nestedArrayPathCalls.push(args[0]);
        }
        return originalFindMixin.apply(this, args);
      };

      try {
        const css = await renderNodeToString(node, context, { context });
        expect(css).toBeString(`
          #used-namespaced-mixin {
            was: included;
          }
        `);
        const generatedFallbackArrayPathCalls = nestedArrayPathCalls.filter(path => (
          !Array.isArray(path)
          || path.length !== 2
          || path[0] !== '#Namespace'
          || path[1] !== '.mixin'
        ));
        expect(generatedFallbackArrayPathCalls).toEqual([]);
        expect(directCrawlHits).toEqual([]);
        expect(directBucketReadCount).toBe(0);
      } finally {
        RulesClass.prototype.findMixinsFast = originalFindMixinsFast;
        RulesClass.prototype.findMixin = originalFindMixin;
        runtimeRulesPrototype.getCallableEntriesForKey = originalGetCallableEntriesForKey;
      }
    });

    it('import-reference: namespaced reference-imported ruleset array-path misses stay off direct crawl', () => {
      const referencedPath = resolve(process.cwd(), 'simple-mixin-array-miss.jess');
      context.sourceTrees.set(referencedPath, rules([
        ruleset({
          selector: el('.mixin'),
          rules: rules([
            decl({ name: any('was'), value: any('included') })
          ])
        })
      ]));

      const node = rules([
        ruleset({
          selector: el('#Namespace'),
          rules: rules([
            style({ path: quoted(any('simple-mixin-array-miss.jess')) }, { type: 'import', importOptions: { reference: true } })
          ])
        })
      ]);
      const directCrawlHits: string[] = [];
      const nestedArrayPathCalls: unknown[] = [];
      const originalFindMixinsFast = RulesClass.prototype.findMixinsFast;
      const originalFindMixin = RulesClass.prototype.findMixin;
      RulesClass.prototype.findMixinsFast = function(...args: Parameters<typeof originalFindMixinsFast>) {
        const [key] = args;
        if (key === '#Namespace' || key === '.missing') {
          directCrawlHits.push(key);
        }
        return originalFindMixinsFast.apply(this, args);
      };
      RulesClass.prototype.findMixin = function(...args: Parameters<typeof originalFindMixin>) {
        if (this !== node && Array.isArray(args[0])) {
          nestedArrayPathCalls.push(args[0]);
        }
        return originalFindMixin.apply(this, args);
      };

      try {
        expect(node.findMixin(['#Namespace', '.missing'], undefined, { searchParents: false })).toBeUndefined();
        expect(nestedArrayPathCalls).toEqual([]);
        expect(directCrawlHits).toEqual([]);
      } finally {
        RulesClass.prototype.findMixinsFast = originalFindMixinsFast;
        RulesClass.prototype.findMixin = originalFindMixin;
      }
    });

    it('import-reference-issues: repeated reference/multiple imports keep import-site-local parent chains', async () => {
      const localContext = createTestContext();
      localContext.opts.collapseNesting = true;
      const nestedPath = resolve(process.cwd(), 'import-reference-issues/multiple-import-nested.jess');
      const importPath = resolve(process.cwd(), 'import-reference-issues/multiple-import.jess');
      localContext.sourceTrees.set(nestedPath, rules([
        ruleset({
          selector: sellist([sel([el('should')])]),
          rules: rules([
            decl({ name: any('be'), value: any('invisible') })
          ])
        }),
        ruleset({
          selector: sellist([sel([el('.something')])]),
          rules: rules([
            decl({ name: any('invisible'), value: any('suppress warning') })
          ])
        }),
        ruleset({
          selector: sellist([sel([el('.invisible')])]),
          rules: rules([
            any('&:extend(.something all)')
          ])
        })
      ]));
      localContext.sourceTrees.set(importPath, rules([
        comment('/*\n  tralala\n*/'),
        ruleset({
          selector: sellist([sel([el('.fix')])]),
          rules: rules([
            decl({ name: any('fix'), value: any('fix') })
          ])
        }),
        ruleset({
          selector: sellist([sel([el('.something')])]),
          rules: rules([
            style({
              path: quoted(any('multiple-import-nested.jess'))
            }, {
              type: 'import',
              importOptions: { reference: true }
            }),
            decl({ name: any('inside'), value: any('something') })
          ])
        })
      ]));

      const node = rules([
        ruleset({
          selector: sellist([sel([el('#do-not-show-import')])]),
          rules: rules([
            style({
              path: quoted(any('import-reference-issues/multiple-import.jess'))
            }, {
              type: 'import',
              importOptions: { reference: true, multiple: true }
            })
          ])
        }),
        ruleset({
          selector: sellist([sel([el('show-all-content')])]),
          rules: rules([
            style({
              path: quoted(any('import-reference-issues/multiple-import.jess'))
            }, {
              type: 'import',
              importOptions: { multiple: true }
            })
          ])
        })
      ]);

      const out = await renderNodeToString(node, localContext, { context: localContext });
      expect(out).toBeString(`
        show-all-content {
          /*
          tralala
        */
        }
        show-all-content .fix {
          fix: fix;
        }
        show-all-content .something {
          inside: something;
        }
      `);
      expect(out).not.toContain('#do-not-show-import .fix');
      expect(out).not.toContain('#do-not-show-import .something');
      expect(out).not.toContain('should {\n  be: invisible;');
    });

    it('import-reference-issues: reference imports inside mixins do not emit imported rulesets', async () => {
      const referencedPath = resolve(process.cwd(), 'import-reference-issues/simple-ruleset-2162.jess');
      context.sourceTrees.set(referencedPath, rules([
        ruleset({
          selector: sellist([sel([el('ruleset')])]),
          rules: rules([
            decl({ name: any('shall-be-invisible'), value: any('less') })
          ])
        })
      ]));

      const node = rules([
        mixin({
          name: any('.mixin-with-import-by-reference-inside'),
          rules: rules([
            decl({ name: any('the-only-property'), value: any('nothing-below-this') }),
            style({
              path: quoted(any('import-reference-issues/simple-ruleset-2162.jess'))
            }, {
              type: 'import',
              importOptions: { reference: true }
            })
          ])
        }),
        ruleset({
          selector: sellist([sel([el('call-mixin-with-import-by-reference-inside')])]),
          rules: rules([
            call({
              name: ref({ key: '.mixin-with-import-by-reference-inside' }, { type: 'mixin-ruleset' }),
              args: list([])
            })
          ])
        })
      ]);

      const out = await renderNodeToString(node, context, { context });
      expect(out).toContain('call-mixin-with-import-by-reference-inside');
      expect(out).toContain('the-only-property: nothing-below-this;');
      expect(out).not.toContain('shall-be-invisible: less;');
      expect(out).not.toContain('call-mixin-with-import-by-reference-inside ruleset');
    });

    it('import-reference: evaluated namespace mixin bodies expose reference-import callable descendants without broad crawl', async () => {
      const localContext = createTestContext();
      const originalFindMixin = RulesClass.prototype.findMixin;
      const originalFindMixinsFast = RulesClass.prototype.findMixinsFast;
      const referencedPath = resolve(process.cwd(), 'reference-namespace-mixin-callable.jess');
      const leaf = mixin({
        name: any('.reference-leaf'),
        rules: rules([decl({ name: any('color'), value: any('green') })])
      });
      localContext.sourceTrees.set(referencedPath, rules([leaf]));
      const namespaceBody = rules([
        style({
          path: quoted(any('reference-namespace-mixin-callable.jess'))
        }, {
          type: 'import',
          importOptions: { reference: true }
        })
      ]);
      const node = rules([
        mixin({
          name: any('#parent-namespace'),
          rules: namespaceBody
        })
      ]);
      const broadFastHits: string[] = [];
      let namespaceBodyFindMixinCount = 0;
      RulesClass.prototype.findMixin = function(...args: Parameters<typeof originalFindMixin>) {
        if (this === namespaceBody) {
          namespaceBodyFindMixinCount++;
        }
        return originalFindMixin.apply(this, args);
      };
      RulesClass.prototype.findMixinsFast = function(...args: Parameters<typeof originalFindMixinsFast>) {
        const [key] = args;
        if ((this === namespaceBody || this === node) && key === '.reference-leaf') {
          broadFastHits.push(this === namespaceBody ? 'namespace' : 'root');
        }
        return originalFindMixinsFast.apply(this, args);
      };

      try {
        await node.prepareRegistration(localContext);
        await namespaceBody.eval(localContext);
        const found = node.findMixin(['#parent-namespace', '.reference-leaf'], undefined);
        expect(found).toHaveLength(1);
        expect(found?.[0]?.name?.valueOf()).toBe('.reference-leaf');
        expect(namespaceBodyFindMixinCount).toBe(0);
        expect(broadFastHits).toEqual([]);
      } finally {
        RulesClass.prototype.findMixin = originalFindMixin;
        RulesClass.prototype.findMixinsFast = originalFindMixinsFast;
      }
    });

    it('import-reference: uncalled namespace mixin body imports stay cold until evaluated', async () => {
      const localContext = createTestContext();
      const originalFindMixinsFast = RulesClass.prototype.findMixinsFast;
      const referencedPath = resolve(process.cwd(), 'reference-uncalled-namespace-mixin-callable.jess');
      localContext.sourceTrees.set(referencedPath, rules([
        mixin({
          name: any('.reference-leaf'),
          rules: rules([decl({ name: any('color'), value: any('green') })])
        })
      ]));
      const namespaceBody = rules([
        style({
          path: quoted(any('reference-uncalled-namespace-mixin-callable.jess'))
        }, {
          type: 'import',
          importOptions: { reference: true }
        })
      ]);
      const node = rules([
        mixin({
          name: any('#parent-namespace'),
          rules: namespaceBody
        })
      ]);
      const broadFastHits: string[] = [];
      RulesClass.prototype.findMixinsFast = function(...args: Parameters<typeof originalFindMixinsFast>) {
        const [key] = args;
        if ((this === namespaceBody || this === node) && key === '.reference-leaf') {
          broadFastHits.push(this === namespaceBody ? 'namespace' : 'root');
        }
        return originalFindMixinsFast.apply(this, args);
      };

      try {
        await node.prepareRegistration(localContext);
        const found = node.findMixin(['#parent-namespace', '.reference-leaf'], undefined, {
          context: localContext
        });
        expect(found).toBeUndefined();
        expect(namespaceBody.evaluated).toBe(false);
        expect(broadFastHits.length).toBeGreaterThan(0);
        expect(broadFastHits.every(hit => hit === 'namespace')).toBe(true);
      } finally {
        RulesClass.prototype.findMixinsFast = originalFindMixinsFast;
      }
    });

    it('import-reference: reference-imported selector-list rulesets remain callable as mixins', async () => {
      const localContext = createTestContext();
      localContext.opts.collapseNesting = true;
      const referencedPath = resolve(process.cwd(), 'import-reference-selector-list.jess');
      localContext.sourceTrees.set(referencedPath, rules([
        ruleset({
          selector: sellist([sel([el('.z')])]),
          rules: rules([
            decl({ name: any('color'), value: any('red') }),
            ruleset({
              selector: sellist([sel([el('.c')])]),
              rules: rules([
                decl({ name: any('color'), value: any('green') })
              ])
            })
          ])
        }),
        ruleset({
          selector: sellist([sel([el('.only-with-visible')]), sel([el('.z')])]),
          rules: rules([
            decl({ name: any('color'), value: any('green') }),
            ruleset({
              selector: sellist([sel([amp(), pseudo({ name: ':hover' })])]),
              rules: rules([
                decl({ name: any('color'), value: any('green') })
              ])
            }),
            ruleset({
              selector: sellist([sel([amp(), co('+'), amp()])]),
              rules: rules([
                decl({ name: any('color'), value: any('green') }),
                ruleset({
                  selector: sellist([sel([el('.sub')])]),
                  rules: rules([
                    decl({ name: any('color'), value: any('green') })
                  ])
                })
              ])
            })
          ])
        })
      ]));

      const node = rules([
        style({
          path: quoted(any('import-reference-selector-list.jess'))
        }, {
          type: 'import',
          importOptions: { reference: true }
        }),
        ruleset({
          selector: sellist([sel([el('.b')])]),
          rules: rules([
            call({
              name: ref({ key: '.z' }, { type: 'mixin-ruleset' }),
              args: list([])
            })
          ])
        })
      ]);

      const out = await renderNodeToString(node, localContext, { context: localContext });
      expect(out).toBeString(`
        .b {
          color: red;
        }
        .b .c {
          color: green;
        }
        .b {
          color: green;
        }
        .b:hover {
          color: green;
        }
        .b + .b {
          color: green;
        }
        .b + .b .sub {
          color: green;
        }
      `);
      expect(out).not.toContain('.only-with-visible');
    });

    it('import-reference: namespaced selector-list array-path lookups stay off direct crawl', async () => {
      const referencedPath = resolve(process.cwd(), 'selector-list-namespace-array.jess');
      context.sourceTrees.set(referencedPath, rules([
        ruleset({
          selector: sellist([sel([el('.mixin')]), sel([el('.alias')])]),
          rules: rules([
            decl({ name: any('was'), value: any('included') })
          ])
        })
      ]));

      const node = rules([
        ruleset({
          selector: el('#Namespace'),
          rules: rules([
            style({ path: quoted(any('selector-list-namespace-array.jess')) }, { type: 'import', importOptions: { reference: true } })
          ])
        }),
        ruleset({
          selector: el('#used-selector-list-namespace'),
          rules: rules([
            call({
              name: ref({ key: ['#Namespace', '.alias'] }, { type: 'mixin-ruleset' })
            })
          ])
        })
      ]);
      const directCrawlHits: string[] = [];
      const nestedArrayPathCalls: unknown[] = [];
      const originalFindMixinsFast = RulesClass.prototype.findMixinsFast;
      const originalFindMixin = RulesClass.prototype.findMixin;
      RulesClass.prototype.findMixinsFast = function(...args: Parameters<typeof originalFindMixinsFast>) {
        const [key] = args;
        if (key === '#Namespace' || key === '.alias' || key === '.missing') {
          directCrawlHits.push(key);
        }
        return originalFindMixinsFast.apply(this, args);
      };
      RulesClass.prototype.findMixin = function(...args: Parameters<typeof originalFindMixin>) {
        if (this !== node && Array.isArray(args[0])) {
          nestedArrayPathCalls.push(args[0]);
        }
        return originalFindMixin.apply(this, args);
      };

      try {
        const css = await renderNodeToString(node, context, { context });
        expect(css).toBeString(`
          #used-selector-list-namespace {
            was: included;
          }
        `);
        expect(node.findMixin(['#Namespace', '.missing'], undefined, { searchParents: false })).toBeUndefined();
        const generatedFallbackArrayPathCalls = nestedArrayPathCalls.filter(path => (
          !Array.isArray(path)
          || path.length !== 2
          || path[0] !== '#Namespace'
          || path[1] !== '.alias'
        ));
        expect(generatedFallbackArrayPathCalls).toEqual([]);
        expect(directCrawlHits).toEqual([]);
      } finally {
        RulesClass.prototype.findMixinsFast = originalFindMixinsFast;
        RulesClass.prototype.findMixin = originalFindMixin;
      }
    });

    it('callable child-surface namespace misses stay off broad start crawl', () => {
      const node = rules([
        rules([
          mixin({
            name: any('#ImportedNamespace'),
            rules: rules([
              mixin({
                name: any('.other'),
                rules: rules([
                  decl({ name: any('was'), value: any('not-used') })
                ])
              })
            ])
          })
        ])
      ]);
      const directCrawlHits: string[] = [];
      const originalFindMixinsFast = RulesClass.prototype.findMixinsFast;
      RulesClass.prototype.findMixinsFast = function(...args: Parameters<typeof originalFindMixinsFast>) {
        const [key] = args;
        if (this === node && key === '#MissingNamespace') {
          directCrawlHits.push(key);
        }
        return originalFindMixinsFast.apply(this, args);
      };

      try {
        expect(node.findMixin(['#MissingNamespace', '.leaf'], undefined, { searchParents: false })).toBeUndefined();
        expect(directCrawlHits).toEqual([]);
      } finally {
        RulesClass.prototype.findMixinsFast = originalFindMixinsFast;
      }
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

    it('import-remote: reference remote imports remain engine imports instead of becoming literal CSS imports', async () => {
      const remotePath = resolve(process.cwd(), 'remote-media.less');
      const remoteUrl = 'https://cdn.jsdelivr.net/npm/example/remote-media.less';
      const remoteContext = new Context({}, [{
        name: 'remote-map',
        supportedExtensions: ['.less'],
        resolve(filePath: string | string[], currentDir: string) {
          const paths = Array.isArray(filePath) ? filePath : [filePath];
          void currentDir;
          return paths.map(candidate => candidate === remoteUrl ? remotePath : candidate);
        },
        locate(pathCandidates: string[]) {
          return pathCandidates.find(candidate => candidate === remotePath) ?? null;
        }
      }]);
      remoteContext.treeContext = {
        file: { name: 'entry.less', path: process.cwd(), fullPath: resolve(process.cwd(), 'entry.less') }
      } as any;
      remoteContext.sourceTrees.set(remotePath, rules([
        vardecl({ name: 'fromRemote', value: any('42') })
      ]));

      const node = rules([
        style({ path: quoted(any(remoteUrl)) }, { type: 'import', importOptions: { reference: true } }),
        decl({ name: any('value'), value: ref('fromRemote', { type: 'variable' }) })
      ]);

      const evald = await node.eval(remoteContext);
      const declaration = evald.at(1) as any;
      const resolved = await declaration.eval(remoteContext);
      expect(resolved.toTrimmedString()).toBe('value: 42');
    });

    it('import.less: optional missing imports do not throw and produce empty rules', async () => {
      const node = rules([
        style({ path: quoted(any('missing-file.jess')) }, { type: 'import', importOptions: { optional: true } })
      ]);
      const evald = await node.eval(context);
      expect(evald.rules.length).toBe(1);
      const imported = evald.at(0) as Rules;
      expect(imported.rules.length).toBe(0);
    });

    it('resolves optional missing imports without touching render state', async () => {
      const node = style(
        { path: quoted(any('missing-file.jess')) },
        { type: 'import', importOptions: { optional: true } }
      );
      const anchor = rules([node]);
      context.root = anchor;
      context.rulesContext = anchor;

      const resolved = await node.resolve(context);

      expect(isNode(resolved, N.Rules)).toBe(true);
      expect((resolved as Rules).rules.length).toBe(0);
      expect(node.evaluated).toBe(false);
      expect(node.registrationPrepared).toBe(false);
      expect(context.printState.writer).toBeUndefined();
    });

    it('writes resolved style import output into segmented buffers', async () => {
      context.sourceTrees.set('buffer-import.jess', rules([
        ruleset({
          selector: el('.buffered'),
          rules: rules([
            decl({ name: any('color'), value: any('red') })
          ])
        })
      ]));
      const node = style(
        { path: quoted(any('buffer-import.jess')) },
        { type: 'import' }
      );
      const anchor = rules([node]);
      context.root = anchor;
      context.rulesContext = anchor;
      const buffer = createRenderBuffer('segmented');
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

      expect(rendered).toBeString(`
        .buffered {
          color: red;
        }
      `);
      expect(buffer.segments).toEqual([rendered]);
      expect(resolveCalls).toBe(0);
      expect(node.evaluated).toBe(false);
      expect(node.registrationPrepared).toBe(false);
    });

    it('renders resolved style import output directly without public resolve', async () => {
      context.sourceTrees.set('direct-import.jess', rules([
        ruleset({
          selector: el('.directed'),
          rules: rules([
            decl({ name: any('color'), value: any('red') })
          ])
        })
      ]));
      const node = style(
        { path: quoted(any('direct-import.jess')) },
        { type: 'import' }
      );
      const anchor = rules([node]);
      context.root = anchor;
      context.rulesContext = anchor;
      node.resolve = () => {
        throw new Error('StyleImport direct render should use evalNode');
      };

      await expect(Promise.resolve(node.render(context))).resolves.toBeString(`
        .directed {
          color: red;
        }
      `);
      expect(node.evaluated).toBe(false);
      expect(node.registrationPrepared).toBe(false);
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
      const css = await renderNodeToString(node, context);
      expect(countSelector(css, '.repeat')).toBe(2);
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
      const css = await renderNodeToString(node, context);
      expect(countSelector(css, '.mix-order')).toBe(1);
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
      const css = await renderNodeToString(node, context);
      expect(countSelector(css, '.mix-order-rev')).toBe(0);
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
      const css = await renderNodeToString(node, context);
      expect(countSelector(css, '.compose-repeat')).toBe(2);
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

      const css = await renderNodeToString(node, context);
      // Should only render `.imported` once (second compose is reference mode by default).
      expect(css.split('.imported').length - 1).toBe(1);
    });

    it('still allows per-import visibility differences via derived Rules wrappers', async () => {
      const originalClone = RulesClass.prototype.clone;
      let clonedLibraryRules = 0;
      RulesClass.prototype.clone = function cloneForCounting(
        this: RulesClass,
        ...args: Parameters<typeof originalClone>
      ): ReturnType<typeof originalClone> {
        if (this.rules.some(node => isNode(node, N.Ruleset))) {
          clonedLibraryRules++;
        }
        return originalClone.apply(this, args);
      };

      try {
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
        expect(evald.rules.length).toBe(2);
        const first = evald.at(0) as Rules;
        const second = evald.at(1) as Rules;
        expect(first.options.rulesVisibility.Ruleset).toBe('public');
        expect(second.options.rulesVisibility.Ruleset).toBe('private');
        expect(clonedLibraryRules).toBe(0);
      } finally {
        RulesClass.prototype.clone = originalClone;
      }
    });
  });
});
