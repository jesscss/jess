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

// Public entry-rule names → internal rule names, so callers can parse a specific
// sub-rule (a selector, a value, a guard, mixin args, …) by a friendly name. Only
// needed where that name differs from the grammar's own rule name — any real rule
// name also works directly via the `?? rule` pass-through below.
const ALIASES: Record<string, string> = {
  stylesheet: 'Stylesheet', main: 'Stylesheet', declaration: 'anyDeclaration',
  declarationList: 'declarationList', selector: 'LessSelectorList',
  complexSelector: 'LessComplexSelector', selectorList: 'LessSelectorList',
  atRule: 'AtRuleBlock', value: 'valueList', valueList: 'valueList',
  comparison: 'Comparison', guard: 'Guard', guardOr: 'GuardOr', guardAnd: 'GuardAnd',
  qualifiedRule: 'MixinOrQualifiedRule', mixinOrQualifiedRule: 'MixinOrQualifiedRule',
  mixinArgs: 'MixinArgs', anonymousMixinDefinition: 'AnonymousMixinDefinition'
};

export type LessFnParseResult = FunctionalParseResult;

export function parseLessFn(
  input: string,
  rule = 'stylesheet',
  mathMode: MathMode = 'parens-division'
): LessFnParseResult {
  host.mathMode = mathMode;
  const ruleName = ALIASES[rule] ?? rule;
  const g = lessGrammar as Record<string, unknown>;
  // Less trivia includes `//` line comments, so trailing `//…` is not leftover.
  return runFunctionalParse(input, g[ruleName], host, { trailingTrivia: g.rw });
}

/** Functional Less parser — call .parse(text) to get a Jess AST. */
export class LessParser {
  private readonly _mathMode: MathMode;

  constructor(config?: { mathMode?: MathMode } & Record<string, unknown>) {
    this._mathMode = config?.mathMode ?? 'parens-division';
  }

  // Arrow field so `const parse = parser.parse` (used in tests) keeps `this`.
  parse = (text: string, rule = 'stylesheet'): LessFnParseResult => {
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
