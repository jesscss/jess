/**
 * Parséman-backed Less parser adapter.
 *
 * Wraps LessGrammar with the same parse(text, rule, options?) API used by
 * the Chevrotain-based LessParser, so tests and callers see no difference.
 */
import { type Node, type Rules, nil } from '@jesscss/core';
import { LessGrammar } from './grammar.js';

// ---------------------------------------------------------------------------
// Config (subset of Chevrotain LessParserConfig — accepted but largely ignored
// by the Parséman grammar which handles math contextually)
// ---------------------------------------------------------------------------

export type LessParserConfig = {
  looseMode?: boolean;
  leakyRules?: boolean;
  mathMode?: 'parens' | 'parens-division' | 'always' | 'strict';
  wrapOuterExpressions?: boolean;
};

// ---------------------------------------------------------------------------
// Result type (compatible with what tests destructure)
// ---------------------------------------------------------------------------

export type ParseResult<T extends Node = Node> = {
  tree: T;
  errors: Array<{ message: string; offset?: number }>;
  warnings: Array<{ message: string }>;
  lexerResult: { errors: Array<unknown> };
  trivia?: undefined;
};

// ---------------------------------------------------------------------------
// Rule name mapping: Chevrotain (lowercase) → Parséman (Capital)
// ---------------------------------------------------------------------------

const RULE_MAP: Record<string, string> = {
  stylesheet: 'Stylesheet',
  main: 'Stylesheet',
  declaration: 'anyDeclaration',
  declarationList: 'declarationList',
  selector: 'LessSelectorList',
  complexSelector: 'LessComplexSelector',
  selectorList: 'LessSelectorList',
  atRule: 'AtRuleBlock',
  value: 'ValueList',
  valueList: 'ValueList',
  comparison: 'Comparison',
  guard: 'Guard',
  guardOr: 'Guard',
  guardAnd: 'Guard',
  qualifiedRule: 'Ruleset',
  mixinOrQualifiedRule: 'Ruleset'
};

// ---------------------------------------------------------------------------
// LessParserParseman
// ---------------------------------------------------------------------------

export class LessParserParseman {
  /** @internal Exposed for diagnostic access */
  grammar: LessGrammar;

  /** @internal Config stored for reference (mathMode not yet implemented) */
  config: LessParserConfig;

  constructor(config: LessParserConfig = {}) {
    this.config = { looseMode: true, ...config };
    this.grammar = new LessGrammar();
    this.parse = this.parse.bind(this);
  }

  parse(text: string): ParseResult<Rules>;
  parse(text: string, rule: 'stylesheet'): ParseResult<Rules>;
  parse(text: string, rule?: string, options?: { context?: unknown }): ParseResult;
  /* eslint-disable @typescript-eslint/no-unsafe-type-assertion */
  parse(text: string, rule = 'stylesheet', _options?: { context?: unknown }): ParseResult {
    const grammarRule = RULE_MAP[rule] ?? rule;
    // RuleKeys<LessGrammar> only accepts capital-letter keys; cast needed for lowercase
    // rules (e.g. anyDeclaration, declarationList) used as entry points.

    const doc = this.grammar.parse(grammarRule as any, text);

    const tree = doc.tree instanceof Object && '_tag' in doc.tree
      ? doc.tree as Node
      : null;

    return {
      tree: (tree ?? nil()) as Node,
      errors: doc.errors.map(e => ({
        message: e.expected?.join(', ') ?? 'Parse error',
        offset: e.span?.start
      })),
      warnings: [],
      lexerResult: { errors: [] }
    };
  }
  /* eslint-enable @typescript-eslint/no-unsafe-type-assertion */
}
