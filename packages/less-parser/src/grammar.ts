/**
 * Functional Less grammar — the macro-compiled counterpart to the class-based
 * LessGrammar. Mirrors the functional CSS grammar (`node()` rules + a BuilderHost
 * that reuses the class builders), extended with the Less-specific rules the
 * class adds on top of CSS. The rules themselves live in ./grammar-rules.ts
 * (macro-neutral, so other grammars can import & inline the fragment); here the
 * macro `rules()` wraps that fragment into the compiled dispatch map — the
 * entry-point registry the parser dispatches into (stylesheet, value, guard, …).
 */
import { rules } from 'parseman' with { type: 'macro' };
import type { Span } from 'parseman';
import { nil, type TriviaMap, type MathMode, type JessError, type Rules } from '@jesscss/core';
import { LessGrammar } from './builders.js';
import { buildLazyTriviaMap, toParseError, runFunctionalParse } from '@jesscss/css-parser';
// The Less grammar fragment (terminals + rule definitions). Kept macro-neutral in
// its own module so other grammars can import & inline it; here the macro `rules()`
// wraps it into the compiled dispatch map, injecting the Less `build` host.
import { lessGrammarRules } from './grammar-rules.js';
// The shared css-parser fragments are spread inside `lessGrammarRules`' return. The
// parseman macro resolves nested `...frag(g)` spreads by NAME against the CONSUMER's
// import bindings, so these names must be imported HERE (not just in grammar-rules.ts)
// for the macro to inline the whole grammar — see docs/guide/extending.md. They are
// referenced only by the macro (not this module's source), hence the disable.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { numericRules, parenRules, queryRules, stringRules } from '@jesscss/css-parser/shared-value-rules';

// ---------------------------------------------------------------------------
// Builder host — reuse LessGrammar's builders (Less + inherited CSS buildNode).
// ---------------------------------------------------------------------------

class BuilderHost extends LessGrammar {
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

  build(type: string, span: { start: number; end: number }, children: ReadonlyArray<unknown>, rawChildren: ReadonlyArray<unknown>): unknown {
    /* eslint-disable @typescript-eslint/no-unsafe-type-assertion */
    return (this as unknown as {
      buildNode(t: string, s: Span, c: ReadonlyArray<unknown>, st: unknown, r: ReadonlyArray<unknown>): unknown;
    }).buildNode(type, span as Span, children, undefined, rawChildren);
    /* eslint-enable @typescript-eslint/no-unsafe-type-assertion */
  }
}

const host = new BuilderHost();

export function build(type: string, children: ReadonlyArray<unknown>, rawChildren: ReadonlyArray<unknown>, span: { start: number; end: number }): unknown {
  return host.build(type, { start: span.start, end: span.end }, children, rawChildren);
}

// ---------------------------------------------------------------------------
// Grammar — the exportable Less fragment, compiled into a rules() dispatch map.
// The fragment is SPREAD (not returned bare) so the macro recognizes the shape
// and inlines `lessGrammarRules` (terminals + rule definitions from
// ./grammar-rules.ts) into the compiled rule map — see docs/guide/extending.md.
// The Less `build` host is injected via the fragment's `deps` argument.
// ---------------------------------------------------------------------------

export const cssRules = rules((g: any) => ({ ...lessGrammarRules(g, { build }) }));

// ---------------------------------------------------------------------------
// Parser — rule-name dispatch (with the class's entry-point aliases).
// ---------------------------------------------------------------------------

const ALIASES: Record<string, string> = {
  stylesheet: 'Stylesheet', main: 'Stylesheet', declaration: 'anyDeclaration',
  declarationList: 'declarationList', selector: 'LessSelectorList',
  complexSelector: 'LessComplexSelector', selectorList: 'LessSelectorList',
  atRule: 'AtRuleBlock', value: 'valueList', valueList: 'valueList',
  comparison: 'Comparison', guard: 'Guard', guardOr: 'GuardOr', guardAnd: 'GuardAnd',
  qualifiedRule: 'MixinOrQualifiedRule', mixinOrQualifiedRule: 'MixinOrQualifiedRule',
  mixinArgs: 'MixinArgs', anonymousMixinDefinition: 'AnonymousMixinDefinition'
};

export type LessFnParseResult = {
  tree: Rules;
  errors: JessError[];
  warnings: Array<{ message: string; deprecation?: string }>;
  trivia: TriviaMap;
};

export function parseLessFn(
  input: string,
  rule = 'stylesheet',
  mathMode: MathMode = 'parens-division'
): LessFnParseResult {
  host.mathMode = mathMode;
  const ruleName = ALIASES[rule] ?? rule;
  const fn = (cssRules as Record<string, unknown>)[ruleName];
  return runFunctionalParse(input, fn, host, { lineComments: true });
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
