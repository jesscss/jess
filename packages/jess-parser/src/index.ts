export { jessGrammar } from './grammar.js';
export { parseJessCst, parseJessDoc } from './cst.js';
export type {
  JessCstChild, JessCstError, JessCstLeaf, JessCstNode, JessCstParseResult, JessCstType
} from './cst.js';

import { run } from 'parseman';
import type { Stylesheet } from '@jesscss/core/ast';
import { jessAstGrammar } from './ast/grammar.js';

/** Structured failure from the public direct Jess parser. */
export class JessParseError extends SyntaxError {
  readonly offset: number;
  readonly expected: readonly string[];

  constructor(message: string, offset: number, expected: readonly string[]) {
    super(message);
    this.name = 'JessParseError';
    this.offset = offset;
    this.expected = expected;
  }
}

function isStylesheet(value: unknown): value is Stylesheet {
  return typeof value === 'object'
    && value !== null
    && 'type' in value
    && value.type === 'Stylesheet'
    && 'children' in value
    && Array.isArray(value.children);
}

/** Parse Jess directly into the canonical AST v2 document. */
export function parse(input: string): Stylesheet {
  const result = run(jessAstGrammar.JessAstDocument, input, { trivia: jessAstGrammar.whitespace });
  if (!result.ok || result.unconsumedFrom !== null || !isStylesheet(result.value)) {
    const offset = result.ok
      ? result.unconsumedFrom ?? result.span.end
      : result.span.start;
    const expected = result.expected;
    const detail = expected.length > 0 ? ` Expected: ${expected.join(', ')}.` : '';
    throw new JessParseError(
      `Jess parse did not produce a complete Stylesheet document at offset ${offset}.${detail}`,
      offset,
      expected
    );
  }
  return result.value;
}
