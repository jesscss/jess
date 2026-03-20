import { Lexer, type IToken } from 'chevrotain';
import { lessTokens, lessFragments } from './lessTokens.js';
import { createLexerDefinition } from '@jesscss/css-parser';
import { LessRecursiveParser, type LessParserConfig, type TokenMap } from './lessRecursiveParser.js';
import type { Node, Rules, IParseResult, TreeContext } from '@jesscss/core';

export type LessRules = keyof {
  [K in keyof LessRecursiveParser as LessRecursiveParser[K] extends (...args: any[]) => Node ? K : never]: true;
};

export type SyntacticContentAssistSuggestion = {
  nextTokenType: string;
  nextTokenLabel?: string;
  ruleStack: string[];
};

/**
 * Less parser using the new recursive-descent engine.
 * Keeps Chevrotain's lexer, replaces the parser.
 */
export class LessParser {
  lexer: Lexer;
  parser: LessRecursiveParser;

  constructor(
    config: LessParserConfig = {}
  ) {
    config = {
      looseMode: true,
      ...config
    };
    const { lexer, T } = createLexerDefinition(
      lessFragments() as unknown as ReadonlyArray<Readonly<[string, string]>>,
      lessTokens()
    );

    this.lexer = new Lexer(lexer, {
      ensureOptimizations: true,
      skipValidations: process.env.TEST !== 'true'
    });
    this.parser = new LessRecursiveParser(T as TokenMap, config);
    this.parse = this.parse.bind(this);
  }

  parse(text: string): IParseResult<Rules>;
  parse(text: string, rule: 'stylesheet'): IParseResult<Rules>;
  parse(text: string, rule?: LessRules, options?: { context?: TreeContext }): IParseResult;
  parse(text: string, rule: LessRules = 'stylesheet', options?: { context?: TreeContext }): IParseResult {
    const parser = this.parser;
    const lexerResult = this.lexer.tokenize(text);
    parser.warnings = [];
    if (options?.context) {
      parser.context = options.context;
    }
    parser.input = lexerResult.tokens;
    const tree = (parser as any)[rule]() as Node;

    const warnings = [...parser.warnings];

    return {
      tree,
      lexerResult,
      errors: parser.errors as any,
      warnings
    };
  }

  /**
   * @todo Implement content assist for the new parser
   */
  suggest(text: string, init: { offset: number; rule?: LessRules }): SyntacticContentAssistSuggestion[] {
    return [];
  }
}
