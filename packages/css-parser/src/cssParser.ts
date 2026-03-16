import { Lexer } from 'chevrotain';
import { cssLexer } from './cssTokens.js';
import { CssRecursiveParser, type CssRecursiveParserConfig } from './cssRecursiveParser.js';
import { type Node, type Rules, type IParseResult } from '@jesscss/core';
import type { IToken } from '@jesscss/parser';

export type CssRules = keyof {
  [K in keyof CssRecursiveParser as CssRecursiveParser[K] extends (...args: any[]) => Node ? K : never]: true;
};

export type SyntacticContentAssistSuggestion = {
  nextTokenType: string;
  nextTokenLabel?: string;
  ruleStack: string[];
};

/**
 * If we're not extending the CSS parser,
 * this is the friendlier interface for returning
 * a CST, as it assigns tokens to the parser automatically.
 */
export class CssParser {
  lexer: Lexer;
  parser: CssRecursiveParser;

  /**
   * @note `recoveryEnabled` should be set to true for
   * linting and language services.
   */
  constructor(
    config: CssRecursiveParserConfig = {}
  ) {
    const { lexer, T } = cssLexer;
    this.lexer = new Lexer(lexer, {
      ensureOptimizations: true,
      skipValidations: process.env.TEST !== 'true'
    });
    this.parser = new CssRecursiveParser(T as any, config);
  }

  parse(text: string): IParseResult<Rules>;
  parse(text: string, rule: 'stylesheet'): IParseResult<Rules>;
  parse(text: string, rule?: CssRules): IParseResult;
  parse(text: string, rule: CssRules = 'stylesheet'): IParseResult {
    const parser = this.parser;
    const lexerResult = this.lexer.tokenize(text);
    parser.input = lexerResult.tokens as IToken[];
    const tree = (parser as any)[rule]() as Node;

    return {
      tree,
      lexerResult,
      errors: parser.errors as any,
      warnings: []
    };
  }

  /**
   * @todo Implement content assist for the new parser
   */
  suggest(text: string, init: { offset: number; rule?: CssRules }): SyntacticContentAssistSuggestion[] {
    return [];
  }
}
