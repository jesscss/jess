/**
 * JessParserParseman — drop-in adapter wrapping JessGrammar.
 *
 * Mirrors the JessParser (Chevrotain) public API so callers can swap parsers
 * without changing call sites.
 */
import type { Node } from '@jesscss/core';
import { JessGrammar } from './grammar.js';

export type JessParserConfig = Record<string, never>;

export type ParseResult<T extends Node = Node> = {
  tree: T | null;
  errors: Array<{ message: string; offset: number }>;
  warnings: Array<string>;
};

type Rules = Node;

const RULE_MAP: Record<string, string> = {
  stylesheet: 'Stylesheet',
  main: 'Stylesheet',
  declaration: 'anyDeclaration',
  declarationList: 'declarationList',
  selector: 'ScssSelectorList',
  complexSelector: 'ScssComplexSelector',
  selectorList: 'ScssSelectorList',
  atRule: 'AtRuleBlock',
  value: 'ValueList',
  valueList: 'ValueList'
};

export class JessParserParseman {
  /** @internal Exposed for diagnostic access */
  readonly grammar: JessGrammar;

  constructor(_config?: JessParserConfig) {
    this.grammar = new JessGrammar();
    this.parse = this.parse.bind(this);
  }

  parse(text: string): ParseResult<Rules>;
  parse(text: string, rule: 'stylesheet'): ParseResult<Rules>;
  parse(text: string, rule?: string, options?: { context?: unknown }): ParseResult;
  /* eslint-disable @typescript-eslint/no-unsafe-type-assertion */
  parse(text: string, rule = 'stylesheet', _options?: { context?: unknown }): ParseResult {
    const grammarRule = RULE_MAP[rule] ?? rule;
    // RuleKeys<JessGrammar> only accepts capital-letter keys; cast needed for lowercase
    // rules (e.g. anyDeclaration, declarationList) used as entry points.

    const doc = this.grammar.parse(grammarRule as any, text);

    const tree = doc.tree instanceof Object && '_tag' in doc.tree
      ? doc.tree as Node
      : null;

    return {
      tree,
      errors: doc.errors.map(e => ({
        message: e.expected?.join(', ') ?? 'Parse error',
        offset: e.span?.start
      })),
      warnings: []
    };
  }
  /* eslint-enable @typescript-eslint/no-unsafe-type-assertion */
}
