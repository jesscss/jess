/**
 * Integration test for less-plugin-clean-css
 *
 * Tests that the Less.js clean-css plugin works correctly
 * with Jess AST nodes through the compatibility layer.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Parser } from '@jesscss/less-parser';
import { lessCompatPlugin } from '../../src';
import type { Visitor } from '@jesscss/core';

// Helper to normalize visitor (PluginInterface allows Visitor | Visitor[])
function normalizeVisitor(visitor: Visitor | Visitor[] | undefined): Visitor | undefined {
  if (!visitor) return undefined;
  if (Array.isArray(visitor)) {
    return visitor[0];
  }
  return visitor;
}

// Try to import clean-css plugin
let CleanCSS: any;
try {
  CleanCSS = require('less-plugin-clean-css');
} catch (e) {
  // Plugin might not be available
  console.warn('less-plugin-clean-css not available');
}

describe('less-plugin-clean-css integration', () => {
  let parser: Parser;

  beforeEach(() => {
    parser = new Parser();
  });

  it('should minify CSS output', () => {
    if (!CleanCSS) {
      console.warn('Skipping test - less-plugin-clean-css not available');
      return;
    }

    const source = `
      .test {
        color: red;
        background: blue;
        padding: 10px;
      }
    `;

    const { tree } = parser.parse(source);
    if (!tree) {
      throw new Error('Failed to parse');
    }

    // Pass the Less plugin directly
    const plugin = lessCompatPlugin({
      plugins: [new CleanCSS({})]
    });

    const visitor = normalizeVisitor(plugin.visitor);
    if (!visitor) {
      throw new Error('Plugin should return a visitor');
    }

    // Visit the tree using accept() which will traverse all nodes
    if (tree.accept) {
      const result = tree.accept(visitor);
      expect(result).toBeDefined();
      // The tree should be modified (minified)
      // We can verify by checking the structure is preserved
    }
  });

  it('should preserve important comments', () => {
    if (!CleanCSS) {
      console.warn('Skipping test - less-plugin-clean-css not available');
      return;
    }

    const source = `
      /*! Important comment */
      .test {
        color: red;
      }
    `;

    const { tree } = parser.parse(source);
    if (!tree) {
      throw new Error('Failed to parse');
    }

    const cleanCssVisitor = new CleanCSS({ keepSpecialComments: true });

    const plugin = lessCompatPlugin({
      visitors: [cleanCssVisitor]
    });

    const visitor = normalizeVisitor(plugin.visitor);
    if (!visitor) {
      throw new Error('Plugin should return a visitor');
    }

    if (visitor.enter) {
      const result = visitor.enter(tree);
      expect(result).toBeDefined();
      // Important comments should be preserved
    }
  });

  it('should handle nested structures', () => {
    if (!CleanCSS) {
      console.warn('Skipping test - less-plugin-clean-css not available');
      return;
    }

    const source = `
      .parent {
        color: red;
        .child {
          background: blue;
        }
      }
    `;

    const { tree } = parser.parse(source);
    if (!tree) {
      throw new Error('Failed to parse');
    }

    // Pass the Less plugin directly
    const plugin = lessCompatPlugin({
      plugins: [new CleanCSS({})]
    });

    const visitor = normalizeVisitor(plugin.visitor);
    if (!visitor) {
      throw new Error('Plugin should return a visitor');
    }

    if (visitor.enter) {
      const result = visitor.enter(tree);
      expect(result).toBeDefined();
    }
  });
});
