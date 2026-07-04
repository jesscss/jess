/**
 * Public functional Jess parser: the build host (reuses JessGrammar's Jess +
 * inherited SCSS/Less/CSS `buildNode`) and the `parseJessFn` entry. The grammar
 * itself lives in ./grammar.ts; the shared driver is reused from
 * @jesscss/css-parser.
 */
import type { Span } from 'parseman';
import type { TriviaMap, JessError, Rules } from '@jesscss/core';
import { runFunctionalParse, type FunctionalParseHost } from '@jesscss/css-parser';
import { jessGrammar } from './grammar.js';
import { JessGrammar } from './builders.js';

// ---------------------------------------------------------------------------
// Builder host — reuse JessGrammar's builders (Jess + inherited SCSS/Less/CSS).
// ---------------------------------------------------------------------------

class BuilderHost extends JessGrammar implements FunctionalParseHost {
  setSource(src: string) {
    this._source = src;
  }

  resetWarnings() {
    this._warnings = [];
    this._errors = [];
  }

  getWarnings() {
    return this._warnings.slice();
  }

  getErrors() {
    return this._errors.slice();
  }

  /** `ctx.build` host: every structural `node(type, …)` builds through this,
   * reusing JessGrammar's (Jess + inherited SCSS/Less/CSS) `buildNode` verbatim. */
  build(type: string, children: ReadonlyArray<unknown>, rawChildren: ReadonlyArray<unknown>, span: { start: number; end: number }): unknown {
    /* eslint-disable @typescript-eslint/no-unsafe-type-assertion */
    return (this as unknown as {
      buildNode(t: string, s: Span, c: ReadonlyArray<unknown>, st: unknown, r: ReadonlyArray<unknown>): unknown;
    }).buildNode(type, { start: span.start, end: span.end } as Span, children, undefined, rawChildren);
    /* eslint-enable @typescript-eslint/no-unsafe-type-assertion */
  }
}

const host = new BuilderHost();

const ALIASES: Record<string, string> = {
  stylesheet: 'Stylesheet',
  main: 'Stylesheet',
  declaration: 'anyDeclaration',
  declarationList: 'declarationList',
  selector: 'LessSelectorList',
  value: 'valueList',
  valueList: 'valueList'
};

export type JessFnParseResult = {
  tree: Rules;
  errors: JessError[];
  warnings: Array<{ message: string; deprecation?: string }>;
  trivia: TriviaMap;
};

export function parseJessFn(input: string, rule = 'stylesheet'): JessFnParseResult {
  const ruleName = ALIASES[rule] ?? rule;
  const g = jessGrammar as Record<string, unknown>;
  // Jess trivia (inherited from SCSS/Less) includes `//` line comments.
  return runFunctionalParse(input, g[ruleName], host, { trailingTrivia: g.rw });
}

/** Functional Jess parser — macro-composed Less + SCSS + Jess. */
export class JessParserParsemanFn {
  parse = (text: string, rule = 'stylesheet'): JessFnParseResult => parseJessFn(text, rule);
}
