import { type IToken, type CstNode, Lexer, type ISyntacticContentAssistPath } from 'chevrotain';
import { lessTokens, lessFragments } from './lessTokens.js';
import { createLexerDefinition } from '@jesscss/css-parser';
import { LessActionsParser, type LessParserConfig, type TokenMap } from './lessActionsParser.js';
import { LessErrorMessageProvider } from './lessErrorMessageProvider.js';
import type { ConditionalPick } from 'type-fest';
import type { Rules, IParseResult } from '@jesscss/core';

export * from './lessActionsParser.js';
export * from './lessTokens.js';

const errorMessageProvider = new LessErrorMessageProvider();

export type LessRules = keyof ConditionalPick<LessActionsParser, () => CstNode>;

export type SyntacticContentAssistSuggestion = {
  nextTokenType: string;
  nextTokenLabel?: string;
  ruleStack: string[];
  occurrenceStack: number[];
};

export class Parser {
  lexer: Lexer;
  /** @todo - return Jess AST as parser */
  parser: LessActionsParser;

  constructor(
    config: LessParserConfig = {}
  ) {
    config = {
      errorMessageProvider,
      /**
       * Override this if you want a stricter Less/CSS parser.
       * @todo - Allow overriding when parsing a single rule.
       */
      looseMode: true,
      skipValidations: process.env.TEST !== 'true',
      ...config
    };
    const { lexer, T } = createLexerDefinition(lessFragments() as unknown as ReadonlyArray<Readonly<[string, string]>>, lessTokens());

    this.lexer = new Lexer(lexer, {
      ensureOptimizations: true,
      skipValidations: process.env.TEST !== 'true'
    });
    this.parser = new LessActionsParser(lexer, T as TokenMap, config);
    /** Not sure why this is necessary, but Less tests were a problem */
    this.parse = this.parse.bind(this);
  }

  parse(text: string): IParseResult<Rules>;
  parse(text: string, rule: 'stylesheet', ...args: Parameters<LessActionsParser['stylesheet']>): IParseResult<Rules>;
  parse<T extends LessRules = LessRules>(text: string, rule?: T, ...args: Parameters<LessActionsParser[T]>): IParseResult;
  parse<T extends LessRules = LessRules>(text: string, rule: T = 'stylesheet' as T, ...args: Parameters<LessActionsParser[T]>): IParseResult {
    const parser = this.parser;
    const lexerResult = this.lexer.tokenize(text);
    const lexedTokens: IToken[] = lexerResult.tokens;
    // Reset warnings BEFORE setting input, in case input setter does something that affects warnings
    parser.warnings = [];
    parser.input = lexedTokens;
    const tree = parser[rule](...args);
    
    // Capture warnings immediately after parsing to ensure they're not lost
    const warnings = [...parser.warnings];

    return { tree, lexerResult, errors: parser.errors, warnings };
  }

  /**
   * IDE helper: suggest next possible token types at `offset` using Chevrotain's
   * syntactic content assist. This is syntactic-only (not semantic completion).
   *
   * Note: content assist is significantly slower than normal parsing, so it
   * should be called on-demand (e.g. near the cursor).
   */
  suggest(text: string, init: { offset: number; rule?: LessRules }): SyntacticContentAssistSuggestion[] {
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