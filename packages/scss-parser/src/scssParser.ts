import { Lexer, type IToken } from 'chevrotain';
import { scssTokens, scssFragments } from './scssTokens.js';
import { createLexerDefinition } from '@jesscss/css-parser';
import { ScssRecursiveParser, type ScssParserConfig, type TokenMap } from './scssRecursiveParser.js';
import type { Node, Rules, IParseResult, TreeContext } from '@jesscss/core';

export type ScssRules = keyof {
  [K in keyof ScssRecursiveParser as ScssRecursiveParser[K] extends (...args: any[]) => Node ? K : never]: true;
};

export type SyntacticContentAssistSuggestion = {
  nextTokenType: string;
  nextTokenLabel?: string;
  ruleStack: string[];
};

/**
 * SCSS parser using the new recursive-descent engine.
 * Keeps Chevrotain's lexer, replaces the parser.
 */
export class ScssParser {
  lexer: Lexer;
  parser: ScssRecursiveParser;

  constructor(
    config: ScssParserConfig = {}
  ) {
    const { lexer, T } = createLexerDefinition(
      scssFragments() as unknown as ReadonlyArray<Readonly<[string, string]>>,
      scssTokens()
    );

    this.lexer = new Lexer(lexer, {
      ensureOptimizations: true,
      skipValidations: process.env.TEST !== 'true'
    });
    this.parser = new ScssRecursiveParser(T as TokenMap, config);
    this.parse = this.parse.bind(this);
  }

  parse(text: string): IParseResult<Rules>;
  parse(text: string, rule: 'stylesheet'): IParseResult<Rules>;
  parse(text: string, rule?: ScssRules, options?: { context?: TreeContext }): IParseResult;
  parse(text: string, rule: ScssRules = 'stylesheet', options?: { context?: TreeContext }): IParseResult {
    const parser = this.parser;
    const lexerResult = this.lexer.tokenize(text);
    parser.warnings = [];
    if (options?.context) {
      parser.context = options.context;
    }
    parser.input = lexerResult.tokens as IToken[];
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
  suggest(text: string, init: { offset: number; rule?: ScssRules }): SyntacticContentAssistSuggestion[] {
    return [];
  }
}
