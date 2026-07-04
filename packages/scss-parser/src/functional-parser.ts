/**
 * Public functional SCSS parser: the build host (reuses ScssGrammar's SCSS +
 * inherited Less/CSS `buildNode`) and the `parseScssFn` / `ScssParser` entry
 * points. The grammar itself lives in ./grammar.ts; the shared driver is reused
 * from @jesscss/css-parser.
 */
import type { Span } from 'parseman';
import type { TriviaMap, JessError, Rules, TreeContext, IParseResult } from '@jesscss/core';
import type { ILexingResult } from 'chevrotain';
import { runFunctionalParse, type FunctionalParseHost } from '@jesscss/css-parser';
import { scssGrammar } from './grammar.js';
import { ScssGrammar } from './builders.js';
import { setParseScssFnForInterp } from './interp.js';
import type { ScssParserConfig, ScssRules } from './scssRecursiveParser.js';
import type { SyntacticContentAssistSuggestion } from './scssParser.js';

// ---------------------------------------------------------------------------
// Builder host — reuse ScssGrammar's builders (SCSS + inherited Less/CSS).
// ---------------------------------------------------------------------------

class BuilderHost extends ScssGrammar implements FunctionalParseHost {
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

  /** `ctx.build` host: every structural `node(type, …)` builds through this,
   * reusing ScssGrammar's (SCSS + inherited Less/CSS) `buildNode` verbatim. */
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
  const g = scssGrammar as Record<string, unknown>;
  host.setContext(options.context);
  // SCSS trivia includes `//` line comments, so trailing `//…` is not leftover.
  return runFunctionalParse(input, g[ruleName], host, { trailingTrivia: g.rw });
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
