import { Lexer } from 'chevrotain';
import { cssLexer } from './cssTokens.js';
import { type TokenMap, type CssParserConfig, CssActionsParser } from './cssActionsParser.js';
import { CssErrorMessageProvider } from './cssErrorMessageProvider.js';
import type { ConditionalPick } from 'type-fest';
import { type Node, type Rules, type IParseResult } from '@jesscss/core';
import type { ISyntacticContentAssistPath } from 'chevrotain';

const errorMessageProvider = new CssErrorMessageProvider();

export type CssRules = keyof ConditionalPick<CssActionsParser, () => Node>;

export type SyntacticContentAssistSuggestion = {
  nextTokenType: string;
  nextTokenLabel?: string;
  ruleStack: string[];
  occurrenceStack: number[];
};

/**
 * If we're not extending the CSS parser,
 * this is the friendlier interface for returning
 * a CST, as it assigns tokens to the parser automatically.
 */
export class CssParser {
  lexer: Lexer;
  parser: CssActionsParser;

  /**
   * @note `recoveryEnabled` should be set to true for
   * linting and language services.
   */
  constructor(
    config: CssParserConfig = {}
  ) {
    config = {
      errorMessageProvider,
      /**
       * Override this if you want to omit legacy IE syntax
       * and ancient CSS hacks.
       * @todo Allow overriding when parsing a single rule.
       */
      legacyMode: true,
      skipValidations: process.env.TEST !== 'true',
      ...config
    };
    const { lexer, T } = cssLexer;
    this.lexer = new Lexer(lexer, {
      ensureOptimizations: true,
      // Always run the validations during testing (dev flows).
      // And avoid validation during productive flows to reduce the Lexer's startup time.
      skipValidations: process.env.TEST !== 'true'
    });
    this.parser = new CssActionsParser(lexer, T as TokenMap, config);
  }

  parse(text: string): IParseResult<Rules>;
  parse(text: string, rule: 'stylesheet'): IParseResult<Rules>;
  parse(text: string, rule?: CssRules): IParseResult;
  parse(text: string, rule: CssRules = 'stylesheet'): IParseResult {
    const parser = this.parser;
    const lexerResult = this.lexer.tokenize(text);
    const lexedTokens = lexerResult.tokens;
    // removed diagnostics
    parser.input = lexedTokens;
    const tree = parser[rule]() as Node;

    return {
      tree,
      lexerResult,
      errors: parser.errors,
      warnings: [] // CSS parser doesn't produce deprecation warnings
    };
  }

  /**
   * IDE helper: suggest next possible token types at `offset` using Chevrotain's
   * syntactic content assist. This is syntactic-only (not semantic completion).
   *
   * Note: content assist is significantly slower than normal parsing, so it
   * should be called on-demand (e.g. near the cursor).
   */
  suggest(text: string, init: { offset: number; rule?: CssRules }): SyntacticContentAssistSuggestion[] {
    const { offset, rule = 'stylesheet' } = init;
    const prefix = text.slice(0, Math.max(0, offset));
    const lexerResult = this.lexer.tokenize(prefix);
    const tokens = lexerResult.tokens;
    try {
      const paths = (this.parser as any).computeContentAssist(rule, tokens) as ISyntacticContentAssistPath[];
      return paths.map(p => ({
        nextTokenType: p.nextTokenType.name,
        nextTokenLabel: (p.nextTokenType as any).LABEL,
        ruleStack: p.ruleStack,
        occurrenceStack: p.occurrenceStack
      }));
    } catch {
      return [];
    }
  }
}