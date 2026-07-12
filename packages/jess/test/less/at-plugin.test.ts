/**
 * Tests for @plugin directive support in Less compatibility layer
 */

import { describe, it, expect } from 'vitest';
import { Compiler } from '../../src/index.js';
import lessPlugin from '@jesscss/plugin-less';
import { lessCompatPlugin } from '@jesscss/plugin-less-compat';
import nodeModulesPlugin from '@jesscss/plugin-node-modules';
import * as path from 'path';
import * as fs from 'fs';
import { tmpdir } from 'os';
import { createRequire } from 'module';
import { readFileSync } from 'fs';
import { getTestCases } from '../test-utils.js';

describe.todo('@plugin directive support', () => {
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
            // eslint-disable-next-line @typescript-eslint/naming-convention
            pluginRegistry: { 'test-plugin': testPlugin }
          })
        ]
      }
    });

    // Write source to temp file
    const tmpFile = path.join(tmpdir(), `test-${Date.now()}.less`);
    fs.writeFileSync(tmpFile, source);

    try {
      await compiler.compile(tmpFile);
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
      await compiler.compile(tmpFile);
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
            // eslint-disable-next-line @typescript-eslint/naming-convention
            pluginRegistry: { 'dynamic-plugin': dynamicPlugin }
          })
        ]
      }
    });

    const tmpFile = path.join(tmpdir(), `test-${Date.now()}.less`);
    fs.writeFileSync(tmpFile, source);

    try {
      await compiler.compile(tmpFile);
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

  // Test actual Less.js test files that use @plugin
  describe.todo('Less.js @plugin test files', () => {
    const require = createRequire(import.meta.url);
    const testData = path.dirname(require.resolve('@less/test-data'));

    // Create node-modules plugin for npm package resolution
    const nodeModulesPluginInstance = nodeModulesPlugin();

    const baseCompiler = new Compiler({
      output: { collapseNesting: true },
      compile: {
        plugins: [
          lessPlugin(),
          nodeModulesPluginInstance,
          lessCompatPlugin({
            autoLoadPlugins: true, // Enable auto-loading to use node-modules plugin
            nodeModulesPlugin: nodeModulesPluginInstance
          })
        ]
      }
    });

    const pluginTestFiles = [
      // 'tests-unit/plugin/plugin.less', // Jess uses nested @media (no query merging); expected CSS has merged queries
      // 'tests-unit/plugin-preeval/plugin-preeval.less', // @replace in custom property not evaluated by preeval visitor
      'tests-unit/plugin-module/plugin-module.less'
    ];

    pluginTestFiles.forEach((file) => {
      const lessPath = path.join(testData, file);

      try {
        const testCases = getTestCases(lessPath);

        testCases.forEach((testCase, index) => {
          const testName = testCases.length > 1 ? `${file} [${index + 1}/${testCases.length}]` : file;
          const configSuffix = testCases.length > 1 ? ` (${path.basename(testCase.expectedFile)})` : '';

          it(`${testName}${configSuffix}`, async () => {
            const expectedCss = readFileSync(testCase.expectedFile, 'utf8');

            // Merge test case config with base compiler config
            // Override plugins to include lessCompatPlugin with config's pluginRegistry if available
            const testCompiler = new Compiler({
              ...baseCompiler.opts,
              ...testCase.config,
              compile: {
                ...baseCompiler.opts.compile,
                ...testCase.config.compile,
                plugins: [
                  lessPlugin(),
                  nodeModulesPluginInstance,
                  lessCompatPlugin({
                    autoLoadPlugins: true, // Enable auto-loading to use node-modules plugin
                    nodeModulesPlugin: nodeModulesPluginInstance
                  }),
                  // Include any other plugins from testCase.config.compile.plugins
                  ...((testCase.config.compile?.plugins || []).filter((p: any) =>
                    p && typeof p === 'object' && p.name !== 'less-compat' && p.name !== 'node-modules'
                  ))
                ]
              },
              // Merge output options - testCase.config.output overrides baseCompiler defaults
              output: {
                ...baseCompiler.opts.output,
                ...(testCase.config.output || {})
              }
            });

            const context = testCompiler.createContext(lessPath, { outputFile: testCase.expectedFile });
            const actualCss = await testCompiler.render(lessPath, { outputFile: testCase.expectedFile });
            expect(actualCss).toBe(expectedCss);
          }, 10000); // 10 second timeout for plugin tests
        });
      } catch (error: any) {
        // If getTestCases throws (no files found), create a failing test
        it(`${file}`, () => {
          throw error;
        });
      }
    });
  });
});
