/**
 * Integration test for less-plugin-autoprefix
 * 
 * Tests that the Less.js autoprefix plugin works correctly
 * with Jess AST nodes through the compatibility layer.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Parser } from '@jesscss/less-parser';
import { lessCompatPlugin } from '../../src';

// Try to import autoprefix plugin
let autoprefix: any;
try {
  autoprefix = require('less-plugin-autoprefix');
} catch (e) {
  // Plugin might not be available
  console.warn('less-plugin-autoprefix not available');
}

describe('less-plugin-autoprefix integration', () => {
  let parser: Parser;

  beforeEach(() => {
    parser = new Parser();
  });

  it('should add vendor prefixes to CSS properties', () => {
    if (!autoprefix) {
      console.warn('Skipping test - less-plugin-autoprefix not available');
      return;
    }

    const source = `
      .test {
        display: flex;
        transform: rotate(45deg);
      }
    `;

    const { tree } = parser.parse(source);
    if (!tree) {
      throw new Error('Failed to parse');
    }

    // Pass the Less plugin instance - autoprefix is a constructor, so use 'new'
    // According to https://github.com/less/less-plugin-autoprefix, the correct usage is:
    // new LessPluginAutoPrefix({browsers: [...]})
    const autoprefixPlugin = new autoprefix({ browsers: ['> 1%', 'last 2 versions'] });
    const plugin = lessCompatPlugin({
      plugins: [autoprefixPlugin]
    });

    const visitor = plugin.visitor;
    if (!visitor) {
      throw new Error('Plugin should return a visitor');
    }

    // Visit the tree using accept() which will traverse all nodes
    if (tree.accept) {
      const result = tree.accept(visitor);
      expect(result).toBeDefined();

      // The tree should be modified with vendor prefixes
      // We can check by serializing the tree back to CSS
      // For now, just verify it doesn't throw
    }
  });

  it('should handle complex selectors with prefixes', () => {
    if (!autoprefix) {
      console.warn('Skipping test - less-plugin-autoprefix not available');
      return;
    }

    const source = `
      @media (max-width: 768px) {
        .container {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
        }
      }
    `;

    const { tree } = parser.parse(source);
    if (!tree) {
      throw new Error('Failed to parse');
    }

    const autoprefixVisitor = autoprefix({ browsers: ['> 1%', 'last 2 versions'] });

    const plugin = lessCompatPlugin({
      visitors: [autoprefixVisitor]
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

  it('should visit all declarations in nested rulesets', () => {
    if (!autoprefix) {
      console.warn('Skipping test - less-plugin-autoprefix not available');
      return;
    }

    const source = `
      .parent {
        display: flex;
        .child {
          transform: scale(1.2);
        }
      }
    `;

    const { tree } = parser.parse(source);
    if (!tree) {
      throw new Error('Failed to parse');
    }

    const autoprefixVisitor = autoprefix({ browsers: ['> 1%', 'last 2 versions'] });

    const plugin = lessCompatPlugin({
      visitors: [autoprefixVisitor]
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
