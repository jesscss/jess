/**
 * Functional SCSS grammar — macro-compiled counterpart to the class-based
 * ScssGrammar. Composes the Less grammar fragment and applies the SCSS delta
 * (`scssGrammarRules`) on top via object spread.
 */
import { rules } from 'parseman' with { type: 'macro' };
import type { Span } from 'parseman';
import type { TriviaMap, JessError, Rules, TreeContext, IParseResult } from '@jesscss/core';
import type { ILexingResult } from 'chevrotain';
import { runFunctionalParse } from '@jesscss/css-parser';
import { lessGrammarRules } from '@jesscss/less-parser/grammar-rules';
import { scssGrammarRules } from './grammar-rules.js';
import { ScssGrammar } from './builders.js';
import { setParseScssFnForInterp } from './interp.js';
import type { ScssParserConfig, ScssRules } from './scssRecursiveParser.js';
import type { SyntacticContentAssistSuggestion } from './scssParser.js';
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

  setContext(context?: TreeContext) {
    this._parseContext = context;
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
// Parser — thin wrapper over the shared css-parser functional-parse driver.
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
};

export type ScssFnParseOptions = {
  context?: TreeContext;
};

export function parseScssFn(
  input: string,
  rule = 'stylesheet',
  options: ScssFnParseOptions = {}
): ScssFnParseResult {
  const ruleName = ALIASES[rule] ?? rule;
  const fn = (scssRules as Record<string, unknown>)[ruleName];
  host.setContext(options.context);
  return runFunctionalParse(input, fn, host, { lineComments: true });
}

setParseScssFnForInterp(parseScssFn);

const EMPTY_LEXER_RESULT: ILexingResult = { tokens: [], errors: [], groups: {} };

function toParseResult(result: ScssFnParseResult): IParseResult<Rules> {
  return {
    tree: result.tree,
    // JessError is the normalized error shape; compatible with IParseResult consumers.
    /* eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion */
    errors: result.errors as IParseResult['errors'],
    warnings: result.warnings,
    trivia: result.trivia,
    lexerResult: EMPTY_LEXER_RESULT
  };
}

/**
 * Functional SCSS parser — the default `Parser` export. Wraps `parseScssFn` and
 * returns the same `IParseResult` shape as the legacy Chevrotain parser (with an
 * empty `lexerResult`; the functional grammar does not tokenize separately).
 */
export class ScssParser {
  constructor(_config: ScssParserConfig = {}) {
    // Config accepted for API compatibility with ScssParserChevrotain; not yet
    // wired through the functional driver.
  }

  parse(text: string): IParseResult<Rules>;
  parse(text: string, rule: 'stylesheet'): IParseResult<Rules>;
  parse(text: string, rule: 'stylesheet', options: { context?: TreeContext }): IParseResult<Rules>;
  parse(text: string, rule?: ScssRules, options?: { context?: TreeContext }): IParseResult;
  parse(text: string, rule: ScssRules = 'stylesheet', options?: { context?: TreeContext }): IParseResult {
    return toParseResult(parseScssFn(text, rule, { context: options?.context }));
  }

  suggest(_text: string, _init?: { offset: number; rule?: ScssRules }): SyntacticContentAssistSuggestion[] {
    return [];
  }
}

/** @deprecated Use {@link ScssParser}. */
export { ScssParser as ScssParserParseman };
