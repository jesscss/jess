/**
 * JessParserParseman — thin adapter over the functional Jess parser.
 *
 * Exposes a stable `.parse(text, rule?)` returning `{ tree, errors, warnings }`
 * so callers (and the test corpus) don't depend on the functional entry's exact
 * shape. The grammar itself lives in ./grammar.ts; builders in ./builders.ts.
 */
import type { Node } from '@jesscss/core';
import { parseJessFn } from './functional-parser.js';

export type JessParserConfig = Record<string, never>;

export type ParseResult<T extends Node = Node> = {
  tree: T | null;
  errors: Array<{ message: string; offset?: number }>;
  warnings: Array<{ message: string; deprecation?: string }>;
};

export class JessParserParseman {
  constructor(_config?: JessParserConfig) {
    this.parse = this.parse.bind(this);
  }

  parse(text: string, rule = 'Stylesheet'): ParseResult {
    const { tree, errors, warnings } = parseJessFn(text, rule);
    return {
      tree: (tree ?? null) as Node | null,
      errors: errors.map(e => ({
        message: e.message
      })),
      warnings
    };
  }
}
