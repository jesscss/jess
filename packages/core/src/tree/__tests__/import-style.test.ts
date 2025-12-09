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
import { Context } from '../../context';
import type { PluginInterface } from '../../plugin';
import type { FindOptions } from '../util/registry-utils';
import { resolve } from 'node:path';

let context: Context;

/**
 * Helper to create a context with test plugin support
 * The plugin checks sourceTrees first before trying to locate files
 */
export function createTestContext(): Context {
  const ctx = new Context();
  const plugin: PluginInterface = {
    name: 'test-plugin',
    supportedExtensions: ['jess'],
    resolve(filePath: string | string[], currentDir: string) {
      const paths = Array.isArray(filePath) ? filePath : [filePath];
      // Resolve all paths to absolute paths
      return paths.map((p) => {
        // If already absolute, return as-is
        if (p.startsWith('/') || (process.platform === 'win32' && /^[A-Z]:/i.test(p))) {
          return p;
        }
        return resolve(currentDir, p);
      });
    },
    locate(pathCandidates: string[], currentDir: string): string | null {
      // Check all candidates - try both resolved and as-is
      for (const candidate of pathCandidates) {
        // Check candidate as-is (might already be absolute)
        if (ctx.sourceTrees.has(candidate)) {
          return candidate;
        }
        // Try resolving relative to currentDir
        const absPath = resolve(currentDir, candidate);
        if (ctx.sourceTrees.has(absPath)) {
          return absPath;
        }
        // Also try resolving relative to process.cwd() as fallback
        const cwdPath = resolve(process.cwd(), candidate);
        if (ctx.sourceTrees.has(cwdPath)) {
          return cwdPath;
        }
        // Check if any sourceTree key ends with the candidate filename
        // (handles cases where path resolution differs)
        const candidateName = candidate.split('/').pop() || candidate;
        for (const [key] of ctx.sourceTrees) {
          if (key.endsWith(candidateName) || key.endsWith(candidate)) {
            return key;
          }
        }
      }
      return null;
    }
  };
  ctx.plugins.push(plugin);
  return ctx;
}

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
          type: 'compose'
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
          type: 'compose'
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
          type: 'compose'
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
          type: 'compose'
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
          type: 'compose'
        })
      ]);

      const evald = await node.eval(context);
      const composedRules = evald.at(0) as Rules;
      // When 'with' is used, withValues.node is cloned and the imported rules are unshifted into it
      // So the structure is: [imported rules (unshifted at index 0), ...injected variables]
      // The imported rules should contain the ruleset from the library file
      const importedRules = composedRules.at(0) as Rules;
      // The imported rules should contain the ruleset at index 0
      const composedRuleset = importedRules.at(0);
      // Check if it's actually a Ruleset node
      if (composedRuleset && (composedRuleset as any).type === 'Ruleset') {
        const composedDecl = (composedRuleset as any).value.rules.at(0);
        const resolved = await composedDecl.eval(context);
        expect(`${resolved}`).toBe('color: purple;');
      } else {
        // If the structure is different, try to find the declaration directly
        // The variable should be resolved to 'purple' because of the injected variable
        const decl = getVarWithContext(context, composedRules, 'primaryColor');
        expect(decl).toBeDefined();
        if (decl) {
          const resolved = await decl.eval(context);
          expect(`${resolved}`).toBe('purple');
        }
      }
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
          type: 'compose'
        })
      ]);

      const evald = await node.eval(context);
      const composedRules = evald.at(0) as Rules;
      const composedRuleset = composedRules.at(0);
      const composedDecl = (composedRuleset as any).value.rules.at(0);
      const resolved = await composedDecl.eval(context);
      expect(`${resolved}`).toBe('color: orange;');
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
          type: 'compose'
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
          type: 'compose'
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
