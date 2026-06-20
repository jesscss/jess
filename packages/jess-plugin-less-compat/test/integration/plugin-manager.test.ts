/**
 * Integration tests for PluginManager and functionRegistry
 *
 * Tests that the Less.js-compatible PluginManager and functionRegistry
 * work correctly with various plugin registration patterns.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Parser } from '@jesscss/less-parser';
import { lessCompatPlugin } from '../../src/index.js';
import { LessPluginManager, LessVisitor, createLessMock } from '../../src/less-compat-structures.js';
import type { Visitor } from '@jesscss/core';

// Helper to normalize visitor (PluginInterface allows Visitor | Visitor[])
function normalizeVisitor(visitor: Visitor | Visitor[] | undefined): Visitor | undefined {
  if (!visitor) {
    return undefined;
  }
  if (Array.isArray(visitor)) {
    return visitor[0];
  }
  return visitor;
}

type TestFunctionRegistry = {
  _data: Record<string, Function>;
  _base: TestFunctionRegistry | null;
  add(name: string, func: Function): void;
  get(name: string): Function | undefined;
  addMultiple(functions: Record<string, Function>): void;
  getLocalFunctions(): Record<string, Function>;
  inherit(): TestFunctionRegistry;
};

describe('PluginManager integration', () => {
  let parser: Parser;

  beforeEach(() => {
    parser = new Parser();
  });

  describe('registerPlugin', () => {
    it('leaves primitive raw segments outside the Less visitor surface', () => {
      let visits = 0;
      const visitor = new LessVisitor({
        visit() {
          visits++;
        }
      });

      expect(visitor.visit('.raw-class')).toBe('.raw-class');
      expect(visitor.visitArray(['.raw-class', 'blue'])).toEqual(['.raw-class', 'blue']);
      expect(visits).toBe(0);
    });

    it('should register a plugin with install method', () => {
      const functionRegistry = {
        add: () => {},
        get: () => undefined,
        addMultiple: () => {},
        getLocalFunctions: () => ({}),
        inherit: () => functionRegistry
      };
      const mockLess = createLessMock(functionRegistry);
      const pluginManager = new LessPluginManager(mockLess, true);

      let installCalled = false;
      const testPlugin = {
        install(less: any, manager: any, registry: any) {
          installCalled = true;
          expect(less).toBe(mockLess);
          expect(manager).toBe(pluginManager);
          expect(registry).toBe(functionRegistry);
        }
      };

      pluginManager.registerPlugin(testPlugin);
      expect(installCalled).toBe(true);
    });

    it('should register a plugin that is a visitor', () => {
      const functionRegistry = {
        add: () => {},
        get: () => undefined,
        addMultiple: () => {},
        getLocalFunctions: () => ({}),
        inherit: () => functionRegistry
      };
      const mockLess = createLessMock(functionRegistry);
      const pluginManager = new LessPluginManager(mockLess, true);

      const testVisitor = {
        visitRuleset(node: any) {
          return node;
        },
        visit(node: any) {
          return node;
        }
      };

      expect(pluginManager.visitors.length).toBe(0);
      pluginManager.registerPlugin(testVisitor);
      expect(pluginManager.visitors.length).toBe(1);
      expect(pluginManager.visitors[0]).toBe(testVisitor);
    });

    it('should handle plugin with both install and visitor methods', () => {
      const functionRegistry = {
        add: () => {},
        get: () => undefined,
        addMultiple: () => {},
        getLocalFunctions: () => ({}),
        inherit: () => functionRegistry
      };
      const mockLess = createLessMock(functionRegistry);
      const pluginManager = new LessPluginManager(mockLess, true);

      let installCalled = false;
      const testPlugin = {
        install(less: any, manager: any, registry: any) {
          installCalled = true;
          manager.addVisitor(this);
        },
        visitRuleset(node: any) {
          return node;
        }
      };

      pluginManager.registerPlugin(testPlugin);
      expect(installCalled).toBe(true);
      expect(pluginManager.visitors.length).toBe(1);
    });
  });

  describe('functionRegistry with new Function', () => {
    it('should handle functions created with new Function()', () => {
      const source = `
        .test {
          color: red;
        }
      `;

      const { tree } = parser.parse(source);
      if (!tree) {
        throw new Error('Failed to parse');
      }

      // Create a function using new Function()
      const dynamicFunction = new Function('a', 'b', 'return a + b;');

      // Create a plugin that registers a function using new Function()
      const testPlugin = {
        install(less: any, manager: any, functionRegistry: any) {
          // Register a function created with new Function()
          functionRegistry.add('dynamicAdd', dynamicFunction);

          // Also test with a regular function
          functionRegistry.add('regularAdd', (a: number, b: number) => a + b);
        }
      };

      const plugin = lessCompatPlugin({
        plugins: [testPlugin]
      });

      const visitor = normalizeVisitor(plugin.visitor);
      if (!visitor) {
        throw new Error('Plugin should return a visitor');
      }

      // The plugin should install without errors
      expect(visitor).toBeDefined();
    });

    it('should handle functions added via addMultiple with new Function()', () => {
      const source = `
        .test {
          color: red;
        }
      `;

      const { tree } = parser.parse(source);
      if (!tree) {
        throw new Error('Failed to parse');
      }

      // Create multiple functions using new Function()
      const func1 = new Function('x', 'return x * 2;');
      const func2 = new Function('x', 'y', 'return x + y;');
      const func3 = (x: number) => x * 3; // Regular function for comparison

      const testPlugin = {
        install(less: any, manager: any, functionRegistry: any) {
          // Add multiple functions at once
          functionRegistry.addMultiple({
            double: func1,
            add: func2,
            triple: func3
          });
        }
      };

      const plugin = lessCompatPlugin({
        plugins: [testPlugin]
      });

      const visitor = normalizeVisitor(plugin.visitor);
      expect(visitor).toBeDefined();
    });

    it('should handle functionRegistry.get() for functions created with new Function()', () => {
      const functionRegistry = {
        _data: {} as Record<string, any>,
        add(name: string, func: any) {
          this._data[name.toLowerCase()] = func;
        },
        get(name: string) {
          return this._data[name.toLowerCase()];
        },
        addMultiple(functions: Record<string, any>) {
          Object.keys(functions).forEach((name) => {
            this.add(name, functions[name]);
          });
        },
        getLocalFunctions() {
          return { ...this._data };
        },
        inherit() {
          return this;
        }
      };
      const mockLess = createLessMock(functionRegistry);
      const pluginManager = new LessPluginManager(mockLess, true);

      // Create function with new Function()
      const dynamicFunc = new Function('x', 'return x * 10;');

      const testPlugin = {
        install(less: any, manager: any, registry: any) {
          registry.add('multiplyByTen', dynamicFunc);
        }
      };

      pluginManager.registerPlugin(testPlugin);

      // Verify the function can be retrieved
      const retrieved = functionRegistry.get('multiplyByTen');
      expect(retrieved).toBe(dynamicFunc);
      expect(typeof retrieved).toBe('function');

      // Test that it works
      expect(retrieved(5)).toBe(50);
    });

    it('should handle functionRegistry.inherit() with new Function()', () => {
      const functionRegistry: TestFunctionRegistry = {
        _data: {},
        _base: null,
        add(name: string, func: Function) {
          this._data[name.toLowerCase()] = func;
        },
        get(name: string) {
          const lowerName = name.toLowerCase();
          if (this._data[lowerName]) {
            return this._data[lowerName];
          }
          if (this._base) {
            return this._base.get(name);
          }
          return undefined;
        },
        addMultiple(functions: Record<string, Function>) {
          Object.keys(functions).forEach((name) => {
            this.add(name, functions[name]);
          });
        },
        getLocalFunctions() {
          return { ...this._data };
        },
        inherit() {
          const child = {
            _data: {} as Record<string, any>,
            _base: this,
            add: functionRegistry.add,
            get: functionRegistry.get,
            addMultiple: functionRegistry.addMultiple,
            getLocalFunctions: functionRegistry.getLocalFunctions,
            inherit: functionRegistry.inherit
          };
          return child;
        }
      };
      const mockLess = createLessMock(functionRegistry);
      const pluginManager = new LessPluginManager(mockLess, true);

      // Create functions with new Function()
      const parentFunc = new Function('x', 'return x + 1;');
      const childFunc = new Function('x', 'return x * 2;');

      const parentPlugin = {
        install(less: any, manager: any, registry: any) {
          registry.add('increment', parentFunc);
        }
      };

      pluginManager.registerPlugin(parentPlugin);

      // Create child registry
      const childRegistry = functionRegistry.inherit();
      childRegistry.add('double', childFunc);

      // Child should have access to its own functions
      expect(childRegistry.get('double')).toBe(childFunc);

      // Child should inherit from parent
      expect(childRegistry.get('increment')).toBe(parentFunc);

      // Parent should not have child's functions
      expect(functionRegistry.get('double')).toBeUndefined();
    });
  });

  describe('functionRegistry scope with new Function', () => {
    it('should maintain function scope when using new Function()', () => {
      const source = `
        .test {
          color: red;
        }
      `;

      const { tree } = parser.parse(source);
      if (!tree) {
        throw new Error('Failed to parse');
      }

      // Create a function that uses closure variables
      const multiplier = 5;
      const scopedFunction = new Function('x', `return x * ${multiplier};`);

      const testPlugin = {
        install(less: any, manager: any, functionRegistry: any) {
          functionRegistry.add('multiplyByFive', scopedFunction);
        }
      };

      const plugin = lessCompatPlugin({
        plugins: [testPlugin]
      });

      const visitor = normalizeVisitor(plugin.visitor);
      expect(visitor).toBeDefined();

      // Verify the function works correctly
      expect(scopedFunction(10)).toBe(50);
    });

    it('should handle functionRegistry.getLocalFunctions() with new Function()', () => {
      const functionRegistry = {
        _data: {} as Record<string, any>,
        add(name: string, func: any) {
          this._data[name.toLowerCase()] = func;
        },
        get(name: string) {
          return this._data[name.toLowerCase()];
        },
        addMultiple(functions: Record<string, any>) {
          Object.keys(functions).forEach((name) => {
            this.add(name, functions[name]);
          });
        },
        getLocalFunctions() {
          return { ...this._data };
        },
        inherit() {
          return this;
        }
      };
      const mockLess = createLessMock(functionRegistry);
      const pluginManager = new LessPluginManager(mockLess, true);

      const func1 = new Function('x', 'return x + 1;');
      const func2 = new Function('x', 'y', 'return x * y;');
      const func3 = (x: number) => x - 1;

      const testPlugin = {
        install(less: any, manager: any, registry: any) {
          registry.add('addOne', func1);
          registry.add('multiply', func2);
          registry.add('subtractOne', func3);
        }
      };

      pluginManager.registerPlugin(testPlugin);

      const localFunctions = functionRegistry.getLocalFunctions();
      expect(Object.keys(localFunctions).length).toBe(3);
      expect(localFunctions.addone).toBe(func1);
      expect(localFunctions.multiply).toBe(func2);
      expect(localFunctions.subtractone).toBe(func3);
    });
  });
});
