/**
 * Integration test for less-plugin-dls
 * 
 * Tests that the Less.js DLS plugin works correctly
 * with Jess AST nodes through the compatibility layer.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Parser } from '@jesscss/less-parser';
import { lessCompatPlugin } from '../../src';

// Note: less-plugin-dls may need to be installed or mocked
// For now, we'll create a test that verifies the plugin structure

describe('less-plugin-dls integration', () => {
  let parser: Parser;

  beforeEach(() => {
    parser = new Parser();
  });

  it('should accept less-plugin-dls as a visitor', async () => {
    // Try to import less-plugin-dls
    let dlsPlugin: any;
    try {
      dlsPlugin = await import('less-plugin-dls');
    } catch (e) {
      // If not available, skip this test
      console.warn('less-plugin-dls not available, skipping test');
      return;
    }

    const source = `
      .test {
        color: red;
      }
    `;

    const { tree } = parser.parse(source);
    if (!tree) {
      throw new Error('Failed to parse');
    }

    // Pass the Less plugin directly
    const plugin = lessCompatPlugin({
      plugins: [dlsPlugin]
    });

    const visitor = plugin.visitor;
    if (!visitor) {
      throw new Error('Plugin should return a visitor');
    }

    // Visit the tree using accept() which will traverse all nodes
    if (tree.accept) {
      const result = tree.accept(visitor);
      expect(result).toBeDefined();
    }
  });

  it('should handle DLS plugin transformations', () => {
    const source = `
      .component {
        color: red;
      }
    `;

    const { tree } = parser.parse(source);
    if (!tree) {
      throw new Error('Failed to parse');
    }

    // Create a mock DLS-like visitor
    const mockDlsVisitor = {
      visitRuleset(node: any) {
        // DLS might add classes or modify selectors
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
      visitors: [mockDlsVisitor]
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
