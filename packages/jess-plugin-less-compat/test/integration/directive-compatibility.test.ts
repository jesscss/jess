/**
 * Integration tests for Less.js v2 Directive compatibility
 *
 * Tests that Less.js v2 "Directive" nodes are correctly mapped to AtRule
 * and that visitDirective() calls work correctly.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Parser } from '@jesscss/less-parser';
import { lessCompatPlugin } from '../../src';
import { LessTreeConstructors } from '../../src/less-compat-structures';
import type { Visitor } from '@jesscss/core';

// Helper to normalize visitor (PluginInterface allows Visitor | Visitor[])
function normalizeVisitor(visitor: Visitor | Visitor[] | undefined): Visitor | undefined {
  if (!visitor) return undefined;
  if (Array.isArray(visitor)) {
    // If array, use the first visitor (or create a composite if needed)
    // For now, just use the first one
    return visitor[0];
  }
  return visitor;
}

describe('Less.js v2 Directive compatibility', () => {
  let parser: Parser;

  beforeEach(() => {
    parser = new Parser();
  });

  it('should create Directive nodes that are compatible with AtRule', () => {
    // Test that new Directive() creates an AtRule-compatible node
    const directive = LessTreeConstructors.Directive('@media', 'screen', [
      { type: 'Ruleset', selectors: [], rules: [] }
    ]);

    expect(directive).toBeDefined();
    expect(directive.type).toBe('Directive');
    expect(directive.name).toBe('@media');
    expect(directive.value).toBe('screen');
    expect(directive.rules).toBeDefined();
    expect(Array.isArray(directive.rules)).toBe(true);
  });

  it('should handle visitDirective() calls and map to atRule', () => {
    const source = `
      @media screen {
        .test {
          color: red;
        }
      }
    `;

    const { tree } = parser.parse(source);
    if (!tree) {
      throw new Error('Failed to parse');
    }

    let visitDirectiveCalled = false;
    let visitAtRuleCalled = false;

    // Create a visitor that uses visitDirective (Less.js v2 style)
    const v2Visitor = {
      visitDirective(node: any) {
        visitDirectiveCalled = true;
        expect(node.type === 'Directive' || node.type === 'AtRule').toBe(true);
        return node;
      }
    };

    // Create a visitor that uses visitAtRule (modern style)
    const modernVisitor = {
      visitAtRule(node: any) {
        visitAtRuleCalled = true;
        expect(node.type === 'Directive' || node.type === 'AtRule').toBe(true);
        return node;
      }
    };

    const plugin = lessCompatPlugin({
      visitors: [v2Visitor, modernVisitor]
    });

    const visitor = normalizeVisitor(plugin.visitor);
    if (!visitor) {
      throw new Error('Plugin should return a visitor');
    }

    if (tree.accept) {
      tree.accept(visitor);
    }

    // At least one of the visitors should have been called
    // (depending on how the node is transformed)
    expect(visitDirectiveCalled || visitAtRuleCalled).toBe(true);
  });

  it('should handle new Directive() constructor in functionRegistry', () => {
    const source = `
      .test {
        color: red;
      }
    `;

    const { tree } = parser.parse(source);
    if (!tree) {
      throw new Error('Failed to parse');
    }

    // Test that functionRegistry.Call and functionRegistry.Directive work
    const testPlugin = {
      install(less: any, manager: any, functionRegistry: any) {
        // Access Directive constructor (Less.js v2 style)
        const Directive = functionRegistry.Directive;
        expect(Directive).toBeDefined();
        expect(typeof Directive).toBe('function');

        // Create a Directive node
        const directive = Directive('@media', 'screen', []);
        expect(directive).toBeDefined();
        expect(directive.type).toBe('Directive');
        expect(directive.name).toBe('@media');
      }
    };

    const plugin = lessCompatPlugin({
      plugins: [testPlugin]
    });

    const visitor = normalizeVisitor(plugin.visitor);
    expect(visitor).toBeDefined();
  });

  it('should handle visitDirective() in LessVisitor wrapper', () => {
    const source = `
      @media print {
        .test {
          color: blue;
        }
      }
    `;

    const { tree } = parser.parse(source);
    if (!tree) {
      throw new Error('Failed to parse');
    }

    let directiveVisited = false;

    const directiveVisitor = {
      visitDirective(node: any) {
        directiveVisited = true;
        // Should receive either Directive or AtRule type
        expect(node.type === 'Directive' || node.type === 'AtRule').toBe(true);
        return node;
      }
    };

    const plugin = lessCompatPlugin({
      visitors: [directiveVisitor]
    });

    const visitor = normalizeVisitor(plugin.visitor);
    if (!visitor) {
      throw new Error('Plugin should return a visitor');
    }

    if (tree.accept) {
      tree.accept(visitor);
    }

    // The visitDirective method should have been called
    expect(directiveVisited).toBe(true);
  });

  it('should handle Directive nodes created via new Directive() in plugins', () => {
    const source = `
      .test {
        color: red;
      }
    `;

    const { tree } = parser.parse(source);
    if (!tree) {
      throw new Error('Failed to parse');
    }

    let directiveCreated = false;

    const testPlugin = {
      install(less: any, manager: any, functionRegistry: any) {
        // Access Directive constructor
        const Directive = functionRegistry.Directive || less.tree.Directive;

        if (Directive) {
          // Create a Directive node (Less.js v2 style)
          const directive = Directive('@charset', '"utf-8"', []);
          directiveCreated = true;

          expect(directive.type).toBe('Directive');
          expect(directive.name).toBe('@charset');
          expect(directive.isCharset()).toBe(true);
        }
      }
    };

    const plugin = lessCompatPlugin({
      plugins: [testPlugin]
    });

    const visitor = normalizeVisitor(plugin.visitor);
    expect(visitor).toBeDefined();
    expect(directiveCreated).toBe(true);
  });

  it('should handle Rule nodes (Less.js v2) and map to Declaration', () => {
    // Test that new Rule() creates a Declaration-compatible node
    const rule = LessTreeConstructors.Rule('color', 'red', '', false, 0, {});

    expect(rule).toBeDefined();
    expect(rule.type).toBe('Rule');
    expect(rule.name).toBe('color');
    expect(rule.value).toBe('red');
  });

  it('should handle visitRule() calls and map to visitDeclaration', () => {
    const source = `
      .test {
        color: red;
      }
    `;

    const { tree } = parser.parse(source);
    if (!tree) {
      throw new Error('Failed to parse');
    }

    let visitRuleCalled = false;
    let visitDeclarationCalled = false;

    // Create a visitor that uses visitRule (Less.js v2 style)
    const v2Visitor = {
      visitRule(node: any) {
        visitRuleCalled = true;
        expect(node.type === 'Rule' || node.type === 'Declaration').toBe(true);
        return node;
      }
    };

    // Create a visitor that uses visitDeclaration (modern style)
    const modernVisitor = {
      visitDeclaration(node: any) {
        visitDeclarationCalled = true;
        expect(node.type === 'Rule' || node.type === 'Declaration').toBe(true);
        return node;
      }
    };

    const plugin = lessCompatPlugin({
      visitors: [v2Visitor, modernVisitor]
    });

    const visitor = normalizeVisitor(plugin.visitor);
    if (!visitor) {
      throw new Error('Plugin should return a visitor');
    }

    if (tree.accept) {
      tree.accept(visitor);
    }

    // At least one of the visitors should have been called
    expect(visitRuleCalled || visitDeclarationCalled).toBe(true);
  });

  it('should map Directive type to AtRule in type mapping', () => {
    const source = `
      @media screen {
        .test {
          color: red;
        }
      }
    `;

    const { tree } = parser.parse(source);
    if (!tree) {
      throw new Error('Failed to parse');
    }

    // Create a visitor that checks node types
    const typeChecker = {
      visitAtRule(node: any) {
        // Should receive AtRule type (mapped from Directive if needed)
        expect(node.type === 'AtRule' || node.type === 'Directive').toBe(true);
        return node;
      },
      visitDirective(node: any) {
        // Less.js v2 style - should also work
        expect(node.type === 'AtRule' || node.type === 'Directive').toBe(true);
        return node;
      }
    };

    const plugin = lessCompatPlugin({
      visitors: [typeChecker]
    });

    const visitor = normalizeVisitor(plugin.visitor);
    if (!visitor) {
      throw new Error('Plugin should return a visitor');
    }

    if (tree.accept) {
      tree.accept(visitor);
    }
  });
});
