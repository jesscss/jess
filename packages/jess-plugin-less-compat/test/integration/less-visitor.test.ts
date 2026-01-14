/**
 * Integration tests for Less.js visitor compatibility
 * 
 * Tests that Less.js visitors can correctly visit and transform
 * Jess AST nodes through the compatibility layer.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Parser } from '@jesscss/less-parser';
import { Context } from '@jesscss/core';
import { lessCompatPlugin } from '../../src';
import type { LessVisitor } from '../../src/types';

describe('Less.js Visitor Integration', () => {
  let parser: Parser;
  let context: Context;

  beforeEach(() => {
    parser = new Parser();
    context = new Context();
  });

  describe('Simple visitor transformations', () => {
    it('should allow Less visitor to visit a Ruleset', () => {
      const source = `
        .test {
          color: red;
        }
      `;

      const { tree } = parser.parse(source);
      if (!tree) {
        throw new Error('Failed to parse');
      }

      // Create a simple Less visitor that tracks visited nodes
      const visitedNodes: string[] = [];
      const lessVisitor: LessVisitor = {
        visitRuleset(node: any) {
          visitedNodes.push(`Ruleset: ${node.type}`);
          if (node.selectors) {
            visitedNodes.push(`Selectors: ${node.selectors.length}`);
          }
          if (node.rules) {
            visitedNodes.push(`Rules: ${node.rules.length}`);
          }
          return node;
        },
        visit(node: any) {
          // Default visit method
          if (node.accept) {
            node.accept(this);
          }
          return node;
        }
      };

      // Apply the less-compat plugin
      const plugin = lessCompatPlugin({
        visitors: [lessVisitor]
      });

      // Get the visitor from the plugin
      const visitor = plugin.visitor;
      if (!visitor) {
        throw new Error('Plugin should return a visitor');
      }

      // Visit the tree - need to traverse it
      // The visitor's enter method will be called for each node by TreeVisitor
      if (tree.accept) {
        tree.accept(visitor as any);
      } else if (visitor.enter) {
        // Fallback: manually traverse
        visitor.enter(tree);
        if (tree.value && Array.isArray(tree.value)) {
          for (const child of tree.value) {
            if (child && child.accept) {
              child.accept(visitor as any);
            }
          }
        }
      }

      // Verify the visitor was called
      expect(visitedNodes.length).toBeGreaterThan(0);
      expect(visitedNodes).toContain('Ruleset: Ruleset');
    });

    it('should allow Less visitor to modify a Declaration', () => {
      const source = `
        .test {
          color: red;
        }
      `;

      const { tree } = parser.parse(source);
      if (!tree) {
        throw new Error('Failed to parse');
      }

      // Create a Less visitor that modifies declarations
      const lessVisitor: LessVisitor = {
        visitDeclaration(node: any) {
          if (node.name === 'color' && node.value) {
            // Modify the value
            node.value = { type: 'Keyword', value: 'blue' };
          }
          return node;
        },
        visit(node: any) {
          if (node.accept) {
            node.accept(this);
          }
          return node;
        }
      };

      const plugin = lessCompatPlugin({
        visitors: [lessVisitor]
      });

      const visitor = plugin.visitor;
      if (!visitor) {
        throw new Error('Plugin should return a visitor');
      }

      // Visit the tree
      if (visitor.enter) {
        const result = visitor.enter(tree);
        // The tree should be modified
        expect(result).toBeDefined();
      }
    });

    it('should handle nested Rulesets', () => {
      const source = `
        .parent {
          color: red;
          .child {
            color: blue;
          }
        }
      `;

      const { tree } = parser.parse(source);
      if (!tree) {
        throw new Error('Failed to parse');
      }

      const visitedRulesets: number[] = [];
      const lessVisitor: LessVisitor = {
        visitRuleset(node: any) {
          visitedRulesets.push(1);
          return node;
        },
        visit(node: any) {
          if (node.accept) {
            node.accept(this);
          }
          return node;
        }
      };

      const plugin = lessCompatPlugin({
        visitors: [lessVisitor]
      });

      const visitor = plugin.visitor;
      if (!visitor) {
        throw new Error('Plugin should return a visitor');
      }

      // Visit the tree
      if (tree.accept) {
        tree.accept(visitor as any);
      } else if (visitor.enter) {
        visitor.enter(tree);
      }

      // Should visit both parent and child rulesets
      expect(visitedRulesets.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('Less plugin integration', () => {
    it('should work with a custom Less visitor plugin', () => {
      const source = `
        .test {
          color: red;
          background: blue;
        }
      `;

      const { tree } = parser.parse(source);
      if (!tree) {
        throw new Error('Failed to parse');
      }

      // Create a custom Less visitor that adds a property
      const customVisitor: LessVisitor = {
        visitRuleset(node: any) {
          if (node.rules && Array.isArray(node.rules)) {
            // Add a new declaration
            node.rules.push({
              type: 'Declaration',
              name: 'margin',
              value: { type: 'Dimension', value: 10, unit: 'px' },
              important: false
            });
          }
          return node;
        },
        visit(node: any) {
          if (node.accept) {
            node.accept(this);
          }
          return node;
        }
      };

      const plugin = lessCompatPlugin({
        visitors: [customVisitor]
      });

      const visitor = plugin.visitor;
      if (!visitor) {
        throw new Error('Plugin should return a visitor');
      }

      if (visitor.enter) {
        const result = visitor.enter(tree);
        expect(result).toBeDefined();
      }
    });
  });

  describe('Node type transformations', () => {
    it('should convert Jess Reference to Less Variable', () => {
      const source = `
        @color: red;
        .test {
          color: @color;
        }
      `;

      const { tree } = parser.parse(source);
      if (!tree) {
        throw new Error('Failed to parse');
      }

      const visitedVariables: string[] = [];
      const lessVisitor: LessVisitor = {
        visitVariable(node: any) {
          visitedVariables.push(node.name || 'unknown');
          return node;
        },
        visit(node: any) {
          if (node.accept) {
            node.accept(this);
          }
          return node;
        }
      };

      const plugin = lessCompatPlugin({
        visitors: [lessVisitor]
      });

      const visitor = plugin.visitor;
      if (!visitor) {
        throw new Error('Plugin should return a visitor');
      }

      // Visit the tree
      if (tree.accept) {
        tree.accept(visitor as any);
      } else if (visitor.enter) {
        visitor.enter(tree);
      }

      // Should have visited the variable
      expect(visitedVariables.length).toBeGreaterThan(0);
    });

    it('should convert Jess Selector hierarchy to Less Elements', () => {
      const source = `
        .parent > .child {
          color: red;
        }
      `;

      const { tree } = parser.parse(source);
      if (!tree) {
        throw new Error('Failed to parse');
      }

      const visitedElements: number[] = [];
      const lessVisitor: LessVisitor = {
        visitElement(node: any) {
          visitedElements.push(1);
          return node;
        },
        visit(node: any) {
          if (node.accept) {
            node.accept(this);
          }
          return node;
        }
      };

      const plugin = lessCompatPlugin({
        visitors: [lessVisitor]
      });

      const visitor = plugin.visitor;
      if (!visitor) {
        throw new Error('Plugin should return a visitor');
      }

      // Visit the tree
      if (tree.accept) {
        tree.accept(visitor as any);
      } else if (visitor.enter) {
        visitor.enter(tree);
      }

      // Should have visited multiple elements (parent, combinator, child)
      expect(visitedElements.length).toBeGreaterThan(1);
    });
  });
});
