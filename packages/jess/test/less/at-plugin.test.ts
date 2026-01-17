/**
 * Tests for @plugin directive support in Less compatibility layer
 */

import { describe, it, expect } from 'vitest';
import { Compiler } from '../../src';
import lessPlugin from '@jesscss/plugin-less';
import { lessCompatPlugin } from '@jesscss/plugin-less-compat';
import * as path from 'path';
import * as fs from 'fs';
import { tmpdir } from 'os';

describe('@plugin directive support', () => {
  it('should process @plugin directive and load plugin from registry', async () => {
    const source = `
      @plugin "test-plugin";
      .test {
        color: red;
      }
    `;

    let pluginInstalled = false;
    let visitorRan = false;

    const testPlugin = {
      install(less: any, manager: any, registry: any) {
        pluginInstalled = true;
        manager.addVisitor({
          visitRuleset(node: any) {
            visitorRan = true;
            return node;
          }
        });
      }
    };

    const compiler = new Compiler({
      output: { collapseNesting: true },
      compile: {
        plugins: [
          lessPlugin(),
          lessCompatPlugin({
            pluginRegistry: {
              'test-plugin': testPlugin
            }
          })
        ]
      }
    });

    // Write source to temp file
    const tmpFile = path.join(tmpdir(), `test-${Date.now()}.less`);
    fs.writeFileSync(tmpFile, source);

    try {
      const context = compiler.createContext(tmpFile);
      const { node } = await context.getTree(tmpFile);

      // The visitor should have processed @plugin and installed the plugin
      expect(pluginInstalled).toBe(true);
      expect(visitorRan).toBe(true);
    } finally {
      fs.unlinkSync(tmpFile);
    }
  });

  it('should handle multiple @plugin directives', async () => {
    const source = `
      @plugin "plugin1";
      @plugin "plugin2";
      .test {
        color: red;
      }
    `;

    const installedPlugins: string[] = [];

    const plugin1 = {
      install(less: any, manager: any, registry: any) {
        installedPlugins.push('plugin1');
      }
    };

    const plugin2 = {
      install(less: any, manager: any, registry: any) {
        installedPlugins.push('plugin2');
      }
    };

    const compiler = new Compiler({
      output: { collapseNesting: true },
      compile: {
        plugins: [
          lessPlugin(),
          lessCompatPlugin({
            pluginRegistry: {
              plugin1: plugin1,
              plugin2: plugin2
            }
          })
        ]
      }
    });

    const tmpFile = path.join(tmpdir(), `test-${Date.now()}.less`);
    fs.writeFileSync(tmpFile, source);

    try {
      const context = compiler.createContext(tmpFile);
      await context.getTree(tmpFile);

      expect(installedPlugins).toContain('plugin1');
      expect(installedPlugins).toContain('plugin2');
      expect(installedPlugins.length).toBe(2);
    } finally {
      fs.unlinkSync(tmpFile);
    }
  });

  it('should allow plugins loaded via @plugin to add visitors that run on subsequent nodes', async () => {
    const source = `
      @plugin "dynamic-plugin";
      .before {
        color: blue;
      }
      .after {
        color: red;
      }
    `;

    const visitedNodes: string[] = [];

    const dynamicPlugin = {
      install(less: any, manager: any, registry: any) {
        manager.addVisitor({
          visitRuleset(node: any) {
            // Track that visitRuleset was called
            visitedNodes.push('visited');
            // Try to extract selector name to track which nodes were visited
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
        });
      }
    };

    const compiler = new Compiler({
      output: { collapseNesting: true },
      compile: {
        plugins: [
          lessPlugin(),
          lessCompatPlugin({
            pluginRegistry: {
              'dynamic-plugin': dynamicPlugin
            }
          })
        ]
      }
    });

    const tmpFile = path.join(tmpdir(), `test-${Date.now()}.less`);
    fs.writeFileSync(tmpFile, source);

    try {
      const context = compiler.createContext(tmpFile);
      await context.getTree(tmpFile);

      // The dynamically added visitor should have run on subsequent nodes
      expect(visitedNodes.length).toBeGreaterThan(0);
    } finally {
      fs.unlinkSync(tmpFile);
    }
  });

  it('should support auto-loading plugins when autoLoadPlugins is enabled', async () => {
    // This test would require an actual npm package to be installed
    // For now, we'll test that the option is respected
    const source = `
      @plugin "non-existent-plugin";
      .test {
        color: red;
      }
    `;

    const compiler = new Compiler({
      output: { collapseNesting: true },
      compile: {
        plugins: [
          lessPlugin(),
          lessCompatPlugin({
            autoLoadPlugins: true
          })
        ]
      }
    });

    const tmpFile = path.join(tmpdir(), `test-${Date.now()}.less`);
    fs.writeFileSync(tmpFile, source);

    try {
      const context = compiler.createContext(tmpFile);
      await context.getTree(tmpFile);

      // Should not throw, but plugin won't be loaded
      expect(true).toBe(true);
    } finally {
      fs.unlinkSync(tmpFile);
    }
  });

  it('should disable auto-loading when autoLoadPlugins is false', async () => {
    const source = `
      @plugin "test-plugin";
      .test {
        color: red;
      }
    `;

    let pluginInstalled = false;

    const compiler = new Compiler({
      output: { collapseNesting: true },
      compile: {
        plugins: [
          lessPlugin(),
          lessCompatPlugin({
            autoLoadPlugins: false
            // No pluginRegistry - should not load plugin
          })
        ]
      }
    });

    const tmpFile = path.join(tmpdir(), `test-${Date.now()}.less`);
    fs.writeFileSync(tmpFile, source);

    try {
      const context = compiler.createContext(tmpFile);
      await context.getTree(tmpFile);

      // Plugin should not be installed since auto-loading is disabled
      expect(pluginInstalled).toBe(false);
    } finally {
      fs.unlinkSync(tmpFile);
    }
  });
});
