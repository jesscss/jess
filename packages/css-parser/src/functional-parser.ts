/**
 * Public functional CSS parser: the build host (reuses `CssParser.buildNode`) and
 * the `parseCssFn` entry. The grammar itself lives in ./grammar.ts; the shared
 * driver in ./functional-driver.ts.
 */
import type { Span } from 'parseman';
import { CssParser } from './builders.js';
import { cssGrammar } from './grammar.js';
import { runFunctionalParse, type FunctionalParseResult, type FunctionalParseHost } from './functional-driver.js';

// ---------------------------------------------------------------------------
// Builder host — reuse CssParser's builders without re-implementing them.
// ---------------------------------------------------------------------------

class BuilderHost extends CssParser implements FunctionalParseHost {
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

  /**
   * `ctx.build` host (parseman RULE_ABI_PLAN §7): every structural `node(type, …)`
   * calls this to construct the Jess AST node, reusing CssParser's `buildNode`
   * (spans, `!important`, declaration splitting, selector collapse) verbatim.
   */
  build(type: string, children: ReadonlyArray<unknown>, rawChildren: ReadonlyArray<unknown>, span: { start: number; end: number }): unknown {
    /* eslint-disable @typescript-eslint/no-unsafe-type-assertion */
    return (this as unknown as {
      buildNode(t: string, s: Span, c: ReadonlyArray<unknown>, st: unknown, r: ReadonlyArray<unknown>): unknown;
    }).buildNode(type, { start: span.start, end: span.end } as Span, children, undefined, rawChildren);
    /* eslint-enable @typescript-eslint/no-unsafe-type-assertion */
  }
}

const host = new BuilderHost();

export function parseCssFn(input: string): FunctionalParseResult {
  // The grammar's own trivia (`rw`) decides what trailing input is leftover:
  // CSS has no `//` line comments, so a trailing `//…` is real leftover here.
  const g = cssGrammar as Record<string, unknown>;
  return runFunctionalParse(input, g.Stylesheet, host, { trailingTrivia: g.rw });
}
