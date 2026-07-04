/**
 * Public functional Less parser: the build host (reuses LessGrammar's Less +
 * inherited CSS `buildNode`) and the `parseLessFn` / `LessParser` entry points.
 * The grammar itself lives in ./grammar.ts; the shared driver is reused from
 * @jesscss/css-parser.
 */
import type { Span } from 'parseman';
import { nil, type MathMode, type Rules } from '@jesscss/core';
import {
  runFunctionalParse, toParseError, buildLazyTriviaMap,
  type FunctionalParseHost, type FunctionalParseResult
} from '@jesscss/css-parser';
import { LessGrammar } from './builders.js';
import { lessGrammar } from './grammar.js';

// ---------------------------------------------------------------------------
// Builder host — reuse LessGrammar's builders (Less + inherited CSS buildNode).
// ---------------------------------------------------------------------------

class BuilderHost extends LessGrammar implements FunctionalParseHost {
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
   * reusing LessGrammar's (Less + inherited CSS) `buildNode` verbatim. */
  build(type: string, children: ReadonlyArray<unknown>, rawChildren: ReadonlyArray<unknown>, span: { start: number; end: number }): unknown {
    /* eslint-disable @typescript-eslint/no-unsafe-type-assertion */
    return (this as unknown as {
      buildNode(t: string, s: Span, c: ReadonlyArray<unknown>, st: unknown, r: ReadonlyArray<unknown>): unknown;
    }).buildNode(type, { start: span.start, end: span.end } as Span, children, undefined, rawChildren);
    /* eslint-enable @typescript-eslint/no-unsafe-type-assertion */
  }
}

const host = new BuilderHost();

export type LessFnParseResult = FunctionalParseResult;

// `rule` is a grammar rule name — the root `Stylesheet` by default, or any rule
// (e.g. `Declaration`, `Guard`, `SelectorList`) to parse that fragment directly.
export function parseLessFn(
  input: string,
  rule = 'Stylesheet',
  mathMode: MathMode = 'parens-division'
): LessFnParseResult {
  host.mathMode = mathMode;
  const g = lessGrammar as Record<string, unknown>;
  // Less trivia includes `//` line comments, so trailing `//…` is not leftover.
  return runFunctionalParse(input, g[rule], host, { trailingTrivia: g.rw });
}

/** Functional Less parser — call .parse(text) to get a Jess AST. */
export class LessParser {
  private readonly _mathMode: MathMode;

  constructor(config?: { mathMode?: MathMode } & Record<string, unknown>) {
    this._mathMode = config?.mathMode ?? 'parens-division';
  }

  // Arrow field so `const parse = parser.parse` (used in tests) keeps `this`.
  parse = (text: string, rule = 'Stylesheet'): LessFnParseResult => {
    // Inline JavaScript (backticks) was removed in v5 — report it as a normal
    // parse error at the backtick, NOT by throwing (a parser must not throw).
    const backtick = text.indexOf('`');
    if (backtick !== -1) {
      return {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        tree: nil() as unknown as Rules,
        errors: [toParseError('Inline JavaScript using backticks is not supported. Use @use / @-use to import a script module instead.', backtick, text)],
        warnings: [],
        trivia: buildLazyTriviaMap([], text)
      };
    }
    return parseLessFn(text, rule, this._mathMode);
  };
}
