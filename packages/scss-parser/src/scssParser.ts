import { Lexer, type IRecognitionException } from 'chevrotain';
import { scssTokens, scssFragments } from './scssTokens.js';
import { createLexerDefinition } from '@jesscss/css-parser';
import { ScssRecursiveParser, type ScssParserConfig } from './scssRecursiveParser.js';
import { nil, type Node, type Rules, type IParseResult, type TreeContext } from '@jesscss/core';

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
      scssFragments(),
      scssTokens()
    );

    this.lexer = new Lexer(lexer, {
      ensureOptimizations: true,
      skipValidations: process.env.TEST !== 'true'
    });
    this.parser = new ScssRecursiveParser(T, config);
    this.parse = this.parse.bind(this);
  }

  parse(text: string): IParseResult<Rules>;
  parse(text: string, rule: 'stylesheet'): IParseResult<Rules>;
  parse(text: string, rule: 'stylesheet', options: { context?: TreeContext }): IParseResult<Rules>;
  parse(text: string, rule?: ScssRules, options?: { context?: TreeContext }): IParseResult;
  parse(text: string, rule: ScssRules = 'stylesheet', options?: { context?: TreeContext }): IParseResult {
    const parser = this.parser;
    const lexerResult = this.lexer.tokenize(text);
    parser.warnings = [];
    if (options?.context) {
      parser.context = options.context;
    }
    parser.context.opts.trivia = undefined;
    parser.sourceText = text;
    parser.input = lexerResult.tokens;
    const ruleMethod = parser[rule];
    if (typeof ruleMethod !== 'function') {
      throw new Error(`Unknown parser rule: ${rule}`);
    }
    const tree = ruleMethod.call(parser);
    const trivia = (parser as ScssRecursiveParser & { trivia: IParseResult['trivia'] }).trivia;
    parser.context.opts.trivia = trivia;
    const resultTree = tree ?? nil();
    (resultTree.sourceRoot?._treeContext ?? parser.context).opts.trivia = trivia;

    const warnings = [...parser.warnings];

    return {
      tree: resultTree,
      lexerResult,
      errors: parser.errors as IRecognitionException[],
      trivia,
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
