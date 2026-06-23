/**
 * Parséman-backed CSS parse function.
 *
 * Uses CssParser (Parséman) to produce Jess core AST nodes.
 * Drop-in conceptual replacement for CssParserChevrotain.parse().
 */
import { Rules } from '@jesscss/core';
import { CssParser } from './grammar.js';

export type ParsemanParseResult = {
  tree: Rules | null;
  errors: Array<{ message: string; offset: number }>;
};

const cssParserInstance = new CssParser();

/**
 * Parse a CSS string and return a Jess Rules AST via the Parséman grammar.
 *
 * Equivalent to `new CssParserChevrotain().parse(text).tree` but using the
 * Parséman-based CssParser.
 */
export function parseCss(input: string): ParsemanParseResult {
  const doc = cssParserInstance.parse('Stylesheet', input);
  return {
    tree: doc.tree instanceof Rules ? doc.tree : null,
    errors: doc.errors.map(e => ({
      message: e.expected.join(', '),
      offset: e.span.start
    }))
  };
}
