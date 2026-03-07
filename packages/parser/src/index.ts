import { type IToken, type CstNode, Lexer, type ISyntacticContentAssistPath } from 'chevrotain';
import { createLexerDefinition } from '@jesscss/css-parser';
import type { ConditionalPick } from 'type-fest';
import type { Rules, IParseResult } from '@jesscss/core';

import { jessFragments, jessTokens } from './jessTokens.js';
import { JessActionsParser, type JessParserConfig, type TokenMap } from './jessActionsParser.js';

export * from './jessActionsParser.js';
export * from './jessTokens.js';

export type JessRules = keyof ConditionalPick<JessActionsParser, () => CstNode>;

export type SyntacticContentAssistSuggestion = {
  nextTokenType: string;
  nextTokenLabel?: string;
  ruleStack: string[];
  occurrenceStack: number[];
};

/**
 * Public convenience wrapper around the Chevrotain lexer + actions parser.
 * Mirrors `@jesscss/scss-parser` and `@jesscss/less-parser` API shape.
 */
export class Parser {
  lexer: Lexer;
  parser: JessActionsParser;

  constructor(config: JessParserConfig = {}) {
    const { lexer, T } = createLexerDefinition(jessFragments(), jessTokens());
    this.lexer = new Lexer(lexer, {
      ensureOptimizations: true,
      skipValidations: process.env.TEST !== 'true'
    });
    this.parser = new JessActionsParser(lexer, T as TokenMap, config);

    // Keep method stable when passed around.
    this.parse = this.parse.bind(this);
  }

  parse(text: string): IParseResult<Rules>;
  parse(text: string, rule: 'stylesheet', ...args: Parameters<JessActionsParser['stylesheet']>): IParseResult<Rules>;
  parse<T extends JessRules = JessRules>(text: string, rule?: T, ...args: Parameters<JessActionsParser[T]>): IParseResult;
  parse<T extends JessRules = JessRules>(
    text: string,
    rule: T = 'stylesheet' as T,
    ...args: Parameters<JessActionsParser[T]>
  ): IParseResult {
    const parser = this.parser;
    // Clear parser errors and warnings from previous parse calls
    parser.errors = [];
    parser.warnings = [];
    const lexerResult = this.lexer.tokenize(text);
    const lexedTokens: IToken[] = lexerResult.tokens;
    parser.input = lexedTokens;
    const tree = parser[rule](...args);
    return { tree, lexerResult, errors: parser.errors, warnings: parser.warnings };
  }

  /**
   * IDE helper: suggest next possible token types at `offset` using Chevrotain's
   * syntactic content assist. This is syntactic-only (not semantic completion).
   *
   * Note: content assist is significantly slower than normal parsing, so it
   * should be called on-demand (e.g. near the cursor).
   */
  suggest(text: string, init: { offset: number; rule?: JessRules }): SyntacticContentAssistSuggestion[] {
    const { offset, rule = 'stylesheet' } = init;
    const prefix = text.slice(0, Math.max(0, offset));
    const lexerResult = this.lexer.tokenize(prefix);
    const tokens: IToken[] = lexerResult.tokens;
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
