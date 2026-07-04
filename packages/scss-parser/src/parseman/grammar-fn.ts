/**
 * Functional SCSS grammar — macro-compiled counterpart to the class-based
 * ScssGrammar. Composes the Less grammar fragment and applies the SCSS delta
 * (`scssGrammarRules`) on top via object spread.
 */
import { rules } from 'parseman' with { type: 'macro' };
import type { Span } from 'parseman';
import { Node, Rules, type TriviaMap, nil, type JessError } from '@jesscss/core';
import { buildLazyTriviaMap, toParseError } from '@jesscss/css-parser';
import { lessGrammarRules } from '@jesscss/less-parser/grammar-rules';
import { scssGrammarRules } from './grammar-rules.js';
import { ScssGrammar } from './grammar.js';
// Macro resolves nested spreads by name against the consumer's import bindings.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { numericRules, parenRules, queryRules, stringRules } from '@jesscss/css-parser/shared-value-rules';

// ---------------------------------------------------------------------------
// Builder host — reuse ScssGrammar's builders (SCSS + inherited Less/CSS).
// ---------------------------------------------------------------------------

class BuilderHost extends ScssGrammar {
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

// Less base, then SCSS overrides (spread order = override order).
export const scssRules = rules((g: any) => ({
  ...lessGrammarRules(g, { build }),
  ...scssGrammarRules(g, { build })
}));

// ---------------------------------------------------------------------------
// Parser — thin wrapper; full driver parity with LessParser is future work.
// ---------------------------------------------------------------------------

const ALIASES: Record<string, string> = {
  stylesheet: 'Stylesheet',
  main: 'Stylesheet',
  declaration: 'anyDeclaration',
  declarationList: 'declarationList',
  selector: 'LessSelectorList',
  value: 'valueList',
  valueList: 'valueList'
};

export type ScssFnParseResult = {
  tree: Rules;
  errors: JessError[];
  warnings: Array<{ message: string; deprecation?: string }>;
  trivia: TriviaMap;
  lexerResult: { errors: Array<unknown> };
};

function firstUnparsedOffset(input: string, from: number): number | null {
  for (let i = from; i < input.length; i++) {
    const c = input[i]!;
    if (c !== ' ' && c !== '\t' && c !== '\n' && c !== '\r' && c !== '\f') {
      return i;
    }
  }
  return null;
}

export function parseScssFn(input: string, rule = 'stylesheet'): ScssFnParseResult {
  const key = ALIASES[rule] ?? rule;
  host.setSource(input);
  host.resetWarnings();
  const fn = (scssRules as Record<string, unknown>)[key];
  const ctx = { trackLines: false };
  /* eslint-disable @typescript-eslint/no-unsafe-type-assertion */
  const r = typeof fn === 'function'
    ? (fn as (i: string, p: number, c: any) => any)(input, 0, ctx)
    : (fn as { parse(i: string, p: number, c: any): any }).parse(input, 0, ctx);
  const tree = (
    r.ok && r.value instanceof Node
      ? r.value
      : r.ok && Array.isArray(r.value)
        ? new Rules(r.value as Node[], undefined, undefined)
        : nil()
  ) as unknown as Rules;

  const errors: JessError[] = [];
  if (!r.ok) {
    errors.push(toParseError((r.expected ?? []).join(', ') || 'Parse error', r.span?.start, input));
  }
  const leftoverAt = r.ok ? firstUnparsedOffset(input, r.span?.end ?? 0) : null;
  if (leftoverAt !== null) {
    errors.push(toParseError('Unexpected input', leftoverAt, input));
  }
  errors.push(...host.getErrors());

  return {
    tree,
    errors,
    warnings: host.getWarnings(),
    trivia: buildLazyTriviaMap([], input),
    lexerResult: { errors: [] }
  };
}

/** Functional SCSS parser — call `.parse(text)` for a Jess AST. */
export class ScssParserParseman {
  parse = (text: string, rule = 'stylesheet'): ScssFnParseResult => parseScssFn(text, rule);
}
