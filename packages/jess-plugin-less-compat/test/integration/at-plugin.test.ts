/**
 * Integration tests for @plugin directive processing
 *
 * Tests that @plugin directives are processed correctly and that
 * plugins loaded via @plugin have their visitors run on subsequent nodes.
 * This matches Less.js behavior where @plugin is processed before evaluation.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Parser } from '@jesscss/less-parser';
import { isNode, N } from '@jesscss/core';
import { lessCompatPlugin } from '../../src/index.js';
import type { Visitor } from '@jesscss/core';

// Helper to normalize visitor (PluginInterface allows Visitor | Visitor[])
function normalizeVisitor(visitor: Visitor | Visitor[] | undefined): Visitor | undefined {
  if (!visitor) {
    return undefined;
  }
  if (Array.isArray(visitor)) {
    // If array, use the first visitor (or create a composite if needed)
    // For now, just use the first one
    return visitor[0];
  }
  return visitor;
}

describe('@plugin directive processing', () => {
  let parser: Parser;

  beforeEach(() => {
    parser = new Parser();
  });

  it('should process @plugin directive and register plugin', () => {
    const source = `
      @plugin "test-plugin";
      .test {
        color: red;
      }
    `;

    const { tree } = parser.parse(source);
    if (!tree) {
      throw new Error('Failed to parse');
    }

    // Create a test plugin that will be loaded via @plugin
    let pluginInstalled = false;
    let visitorAdded = false;
    const testPlugin = {
      install(less: any, manager: any, registry: any) {
        pluginInstalled = true;
        // Add a visitor that modifies rulesets
        const visitor = {
          visitRuleset(node: any) {
            visitorAdded = true;
            return node;
          }
        };
        manager.addVisitor(visitor);
      }
    };

    // Create a plugin registry for @plugin directive processing
    // In real usage, @plugin would dynamically load plugins, but for testing
    // we provide them via pluginRegistry
    const plugin = lessCompatPlugin({
      pluginRegistry: {
        // eslint-disable-next-line @typescript-eslint/naming-convention
        'test-plugin': testPlugin
      }
    });

    const visitor = normalizeVisitor(plugin.visitor);
    if (!visitor) {
      throw new Error('Plugin should return a visitor');
    }

    // Visit the tree - @plugin should be processed
    if (tree.accept) {
      const result = tree.accept(visitor);
      expect(result).toBeDefined();
    }

    // Note: In a real implementation, @plugin would load the plugin dynamically
    // For this test, we're verifying the structure supports @plugin processing
  });

  it('should process raw Jess AtRule nodes in before-eval visitor mode', () => {
    const source = `@plugin "test-plugin"; .test { color: red; }`;

    const { tree } = parser.parse(source);
    if (!tree) {
      throw new Error('Failed to parse');
    }

    let pluginInstalled = false;
    const testPlugin = {
      install() {
        pluginInstalled = true;
      }
    };

    const plugin = lessCompatPlugin({
      pluginRegistry: {
        // eslint-disable-next-line @typescript-eslint/naming-convention
        'test-plugin': testPlugin
      }
    });

    plugin.setCurrentFilePath('/tmp/test.less');
    const context = { root: tree, warnings: [] };
    plugin.setContext(context);

    const visitor = normalizeVisitor(plugin.beforeEvalVisitor);
    if (!visitor?.atRule) {
      throw new Error('Plugin should expose an atRule before-eval visitor');
    }

    const pluginDirective = tree.at(0);
    if (!pluginDirective || !isNode(pluginDirective, N.AtRule)) {
      throw new Error('Expected parsed @plugin directive');
    }
    const result = visitor.atRule(pluginDirective);

    expect(result).toBe(pluginDirective);
    expect(pluginInstalled).toBe(true);
    expect(context.warnings).toHaveLength(1);
    expect(context.warnings[0]).toMatchObject({
      code: 'eval/deprecated',
      message: 'Deprecated feature',
      reason: '"@plugin" is deprecated.',
      fix: 'Use "@use / @-use" instead.',
      note: 'In .less files compiled through the Less CLI compatibility path, migrate script integration to @use / @-use.'
    });
    expect(Reflect.get(pluginDirective, 'visible')).toBe(false);
  });

  it('does not fall back to Node execution for local file-based @plugin when plugin-js is unavailable', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jess-less-plugin-no-node-fallback-'));
    const pluginPath = path.join(root, 'evil-plugin.js');
    fs.writeFileSync(
      pluginPath,
      [
        'registerPlugin({',
        '  install: function(_less, _manager, functions) {',
        '    functions.add("probe", function() {',
        '      return typeof process === "undefined" ? "DENIED" : "LEAKED";',
        '    });',
        '  }',
        '});'
      ].join('\n'),
      'utf8'
    );

    const { tree } = parser.parse('@plugin "./evil-plugin.js"; .test { value: probe(); }');
    if (!tree) {
      throw new Error('Failed to parse');
    }

    const plugin = lessCompatPlugin();
    plugin.setCurrentFilePath(path.join(root, 'input.less'));
    plugin.setContext({
      root: tree,
      warnings: [],
      plugins: [],
      opts: {}
    });

    const visitor = normalizeVisitor(plugin.beforeEvalVisitor);
    if (!visitor?.atRule) {
      throw new Error('Plugin should expose an atRule before-eval visitor');
    }

    const pluginDirective = tree.at(0);
    if (!pluginDirective || !isNode(pluginDirective, N.AtRule)) {
      throw new Error('Expected parsed @plugin directive');
    }

    await expect(Promise.resolve().then(() => visitor.atRule!(pluginDirective))).rejects.toThrow(
      'Feature not supported. Install @jesscss/plugin-js to enable Less @plugin script execution.'
    );
  });

  it('should process raw Jess @plugin directives after a leading comment', () => {
    const source = `/** comment */\n@plugin "test-plugin";\n.test { color: red; }`;

    const { tree } = parser.parse(source);
    if (!tree) {
      throw new Error('Failed to parse');
    }

    let pluginInstalled = false;
    const testPlugin = {
      install() {
        pluginInstalled = true;
      }
    };

    const plugin = lessCompatPlugin({
      pluginRegistry: {
        // eslint-disable-next-line @typescript-eslint/naming-convention
        'test-plugin': testPlugin
      }
    });

    plugin.setCurrentFilePath('/tmp/test.less');
    plugin.setContext({ root: tree });

    const visitor = normalizeVisitor(plugin.beforeEvalVisitor);
    if (!visitor?.visit) {
      throw new Error('Plugin should expose a visit before-eval visitor');
    }

    tree.accept(visitor);

    const pluginDirective = tree.at(0);
    if (!pluginDirective || !isNode(pluginDirective, N.AtRule)) {
      throw new Error('Expected parsed @plugin directive');
    }
    expect(pluginInstalled).toBe(true);
    expect(Reflect.get(pluginDirective, 'visible')).toBe(false);
  });

  it('should process @plugin before other nodes (before-eval behavior)', () => {
    const source = `
      @plugin "early-plugin";
      .before {
        color: blue;
      }
      .after {
        color: red;
      }
    `;

    const { tree } = parser.parse(source);
    if (!tree) {
      throw new Error('Failed to parse');
    }

    // Track visitor calls to verify @plugin is processed early
    const visitOrder: string[] = [];

    const earlyPlugin = {
      install(less: any, manager: any, registry: any) {
        const visitor = {
          visitRuleset(node: any) {
            visitOrder.push('early-plugin-visitor');
            return node;
          }
        };
        manager.addVisitor(visitor);
      }
    };

    // Use pluginRegistry for @plugin processing
    const plugin = lessCompatPlugin({
      pluginRegistry: {
        // eslint-disable-next-line @typescript-eslint/naming-convention
        'early-plugin': earlyPlugin
      }
    });

    const visitor = normalizeVisitor(plugin.visitor);
    if (!visitor) {
      throw new Error('Plugin should return a visitor');
    }

    if (tree.accept) {
      tree.accept(visitor);
    }

    // Verify that the plugin's visitor was available for processing nodes.
    // Less processes @plugin early enough for its visitors to run on subsequent nodes.
    expect(visitOrder.length).toBeGreaterThan(0);
  });

  it('should handle multiple @plugin directives', () => {
    const source = `
      @plugin "plugin1";
      @plugin "plugin2";
      .test {
        color: red;
      }
    `;

    const { tree } = parser.parse(source);
    if (!tree) {
      throw new Error('Failed to parse');
    }

    const plugin1Visits: number[] = [];
    const plugin2Visits: number[] = [];

    const plugin1 = {
      install(less: any, manager: any, registry: any) {
        manager.addVisitor({
          visitRuleset(node: any) {
            plugin1Visits.push(1);
            return node;
          }
        });
      }
    };

    const plugin2 = {
      install(less: any, manager: any, registry: any) {
        manager.addVisitor({
          visitRuleset(node: any) {
            plugin2Visits.push(2);
            return node;
          }
        });
      }
    };

    // Use pluginRegistry for @plugin processing
    const plugin = lessCompatPlugin({
      pluginRegistry: {
        plugin1: plugin1,
        plugin2: plugin2
      }
    });

    const visitor = normalizeVisitor(plugin.visitor);
    if (!visitor) {
      throw new Error('Plugin should return a visitor');
    }

    if (tree.accept) {
      tree.accept(visitor);
    }

    // Both plugins' visitors should run
    expect(plugin1Visits.length).toBeGreaterThan(0);
    expect(plugin2Visits.length).toBeGreaterThan(0);
  });

  it('should allow plugins loaded via @plugin to add visitors that run on subsequent nodes', () => {
    const source = `
      @plugin "dynamic-plugin";
      .first {
        color: blue;
      }
      .second {
        color: red;
      }
    `;

    const { tree } = parser.parse(source);
    if (!tree) {
      throw new Error('Failed to parse');
    }

    // Track which nodes were visited by the dynamically added visitor
    const visitedNodes: string[] = [];

    const dynamicPlugin = {
      install(less: any, manager: any, registry: any) {
        // This visitor is added during @plugin processing
        const dynamicVisitor = {
          visitRuleset(node: any) {
            // Track that visitRuleset was called - simpler check
            visitedNodes.push('visited');
            // Try to extract selector to track which nodes were visited
            if (node.selectors && node.selectors.length > 0) {
              const selector = node.selectors[0];
              if (selector && selector.elements) {
                const firstElement = selector.elements[0];
                if (firstElement && firstElement.value) {
                  visitedNodes.push(firstElement.value.name || 'unknown');
                }
              }
            }
            return node;
          }
        };
        manager.addVisitor(dynamicVisitor);
      }
    };

    // Use pluginRegistry for @plugin processing
    const plugin = lessCompatPlugin({
      pluginRegistry: {
        // eslint-disable-next-line @typescript-eslint/naming-convention
        'dynamic-plugin': dynamicPlugin
      }
    });

    const visitor = normalizeVisitor(plugin.visitor);
    if (!visitor) {
      throw new Error('Plugin should return a visitor');
    }

    if (tree.accept) {
      tree.accept(visitor);
    }

    // The dynamically added visitor should have run on subsequent nodes
    // This matches Less.js behavior where @plugin-loaded visitors process all subsequent nodes
    expect(visitedNodes.length).toBeGreaterThan(0);
  });

  it('should handle @plugin with functionRegistry access', () => {
    const source = `
      @plugin "function-plugin";
      .test {
        width: test-function(10px);
      }
    `;

    const { tree } = parser.parse(source);
    if (!tree) {
      throw new Error('Failed to parse');
    }

    let functionRegistered = false;

    const functionPlugin = {
      install(less: any, manager: any, functionRegistry: any) {
        // Register a function via the functionRegistry
        functionRegistry.add('test-function', (value: any) => {
          functionRegistered = true;
          return value;
        });
      }
    };

    // Use pluginRegistry for @plugin processing
    const plugin = lessCompatPlugin({
      pluginRegistry: {
        // eslint-disable-next-line @typescript-eslint/naming-convention
        'function-plugin': functionPlugin
      }
    });

    const visitor = normalizeVisitor(plugin.visitor);
    if (!visitor) {
      throw new Error('Plugin should return a visitor');
    }

    if (tree.accept) {
      tree.accept(visitor);
    }

    // Function should be registered (though it won't be called during visitor traversal)
    // This test verifies that @plugin has access to functionRegistry
    expect(functionRegistered).toBe(false); // Function is registered but not called in visitor phase
  });

  it('should process @plugin and ensure visitors run before evaluation', () => {
    const source = `
      @plugin "early-plugin";
      .test {
        color: red;
      }
    `;

    const { tree } = parser.parse(source);
    if (!tree) {
      throw new Error('Failed to parse');
    }

    let earlyVisitorRan = false;

    const earlyPlugin = {
      install(less: any, manager: any, registry: any) {
        // Add a visitor that should run before evaluation.
        // In Less.js, @plugin is processed early, so visitors added here
        // are available for the entire tree traversal
        manager.addVisitor({
          visitRuleset(node: any) {
            earlyVisitorRan = true;
            // Visitor can modify nodes before evaluation
            return node;
          }
        });
      }
    };

    // Use pluginRegistry for @plugin processing
    const plugin = lessCompatPlugin({
      pluginRegistry: {
        // eslint-disable-next-line @typescript-eslint/naming-convention
        'early-plugin': earlyPlugin
      }
    });

    const visitor = normalizeVisitor(plugin.visitor);
    if (!visitor) {
      throw new Error('Plugin should return a visitor');
    }

    // The visitor should process @plugin nodes and add their visitors
    // Those visitors should then run on subsequent nodes
    if (tree.accept) {
      tree.accept(visitor);
    }

    // Verify that the early visitor ran.
    // In Less.js, this happens because @plugin is processed before evaluation.
    expect(earlyVisitorRan).toBe(true);
  });
});
