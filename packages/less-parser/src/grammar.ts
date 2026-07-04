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
import { Node, Rules, type TriviaMap, type MathMode, nil, type JessError } from '@jesscss/core';
import { LessGrammar } from './builders.js';
import { buildLazyTriviaMap, toParseError } from '@jesscss/css-parser';
// The Less grammar fragment (terminals + rule definitions). Kept macro-neutral in
// its own module so other grammars can import & inline it; here the macro `rules()`
// wraps it into the compiled dispatch map, injecting the Less `build` host.
import { lessGrammarRules } from './grammar-rules.js';
import { attachHydrationToTree, type HydrationAttachOptions } from './attach-hydration.js';
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

/**
 * First offset at/after `from` holding real (non-trivia) input, or null if only
 * whitespace / block / line comments remain — the point the grammar stopped short
 * on. Mirrors the less `rw` trivia (ws + block + line comments).
 */
function firstUnparsedOffset(input: string, from: number): number | null {
  let i = from;
  while (i < input.length) {
    const c = input[i]!;
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f') {
      i++;
      continue;
    }
    if (c === '/' && input[i + 1] === '*') {
      const end = input.indexOf('*/', i + 2);
      if (end === -1) {
        return i;
      }
      i = end + 2;
      continue;
    }
    if (c === '/' && input[i + 1] === '/') {
      const nl = input.indexOf('\n', i + 2);
      if (nl === -1) {
        return null;
      }
      i = nl + 1;
      continue;
    }
    return i;
  }
  return null;
}

export function parseLessFn(
  input: string,
  rule = 'stylesheet',
  mathMode: MathMode = 'parens-division',
  options: HydrationAttachOptions = {}
): LessFnParseResult {
  host.setSource(input);
  host.mathMode = mathMode;
  host.resetWarnings();
  const ruleName = ALIASES[rule] ?? rule;
  const fn = (cssRules as Record<string, unknown>)[ruleName];
  const triviaLog: number[] = [];
  const parseErrors: Array<{ span: { start: number }; expected: string[] }> = [];
  const ctx = { trackLines: false, _triviaLog: triviaLog, _errors: parseErrors };
  /* eslint-disable @typescript-eslint/no-unsafe-type-assertion */
  const r = typeof fn === 'function'
    ? (fn as (i: string, p: number, c: any) => any)(input, 0, ctx)
    : (fn as { parse(i: string, p: number, c: any): any }).parse(input, 0, ctx);

  // A single-node rule yields that node; a `many(...)` entry rule (e.g. an
  // `declarationList` fragment) yields an array — wrap it in a Rules so callers
  // get a `.rules` body rather than a bare Nil.
  const tree = (
    r.ok && r.value instanceof Node
      ? r.value
      : r.ok && Array.isArray(r.value)
        ? new Rules(r.value as Node[], undefined, undefined)
        : nil()
  ) as unknown as Rules;
  /* eslint-enable @typescript-eslint/no-unsafe-type-assertion */

  // Same model as parseCssFn: expect()/recover() ParseErrors, a hard top-level
  // failure, and any unconsumed input — report the earliest (one error, stop).
  const collected: Array<{ message: string; offset?: number }> = [];
  for (const e of parseErrors) {
    const exp = e.expected.filter(x => x !== 'sentinel');
    collected.push({ message: exp.length ? `expected ${exp.join(', ')}` : 'Unexpected input', offset: e.span.start });
  }
  if (!r.ok) {
    collected.push({ message: (r.expected ?? []).join(', ') || 'Parse error', offset: r.span?.start });
  }
  const leftoverAt = r.ok ? firstUnparsedOffset(input, r.span?.end ?? 0) : null;
  if (leftoverAt !== null) {
    collected.push({ message: 'Unexpected input', offset: leftoverAt });
  }
  collected.push(...host.getErrors());
  collected.sort((a, b) => (a.offset ?? 0) - (b.offset ?? 0));
  const errors: JessError[] = collected.length > 0
    ? [toParseError(collected[0]!.message, collected[0]!.offset, input)]
    : [];

  if (options.attachHydration !== false && tree instanceof Node) {
    attachHydrationToTree(
      tree,
      (wrapped) => {
        const result = parseLessFn(wrapped, 'stylesheet', mathMode, { attachHydration: false });
        return { tree: result.tree, errors: result.errors };
      },
      mathMode
    );
  }

  return { tree, errors, warnings: host.getWarnings(), trivia: buildLazyTriviaMap(triviaLog, input) };
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
