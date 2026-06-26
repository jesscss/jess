import { Lexer } from 'chevrotain';
import { cssLexer } from './cssTokens.js';
import { CssRecursiveParser, type CssRecursiveParserConfig } from './cssRecursiveParser.js';
import { nil, type Node, type Rules, type IParseResult } from '@jesscss/core';

export type CssRules = keyof {
  [K in keyof CssRecursiveParser as CssRecursiveParser[K] extends (...args: any[]) => Node ? K : never]: true;
};

export type SyntacticContentAssistSuggestion = {
  nextTokenType: string;
  nextTokenLabel?: string;
  ruleStack: string[];
};

/**
 * @deprecated LEGACY — Chevrotain-based CSS parser.
 * Kept only for benchmarking against CssParser (Parséman).
 * TO BE DELETED once Parséman integration is complete.
 *
 * The replacement is exported as CssParser from ./parseman/index.js.
 */
export class CssParserChevrotain {
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
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    this.parser = new CssRecursiveParser(T as import('./cssRecursiveParser.js').TokenMap, config);
  }

  parse(text: string): IParseResult<Rules>;
  parse(text: string, rule: 'stylesheet'): IParseResult<Rules>;
  parse(text: string, rule?: CssRules): IParseResult;
  parse(text: string, rule: CssRules = 'stylesheet'): IParseResult {
    const parser = this.parser;
    const lexerResult = this.lexer.tokenize(text);
    parser.context.opts.trivia = undefined;
    parser.sourceText = text;
    parser.input = lexerResult.tokens;
    const ruleFn = parser[rule];
    if (typeof ruleFn !== 'function') {
      throw new Error(`Unknown parser rule: ${rule}`);
    }
    const tree = ruleFn.call(parser);
    const trivia = parser.trivia;
    parser.context.opts.trivia = trivia;
    const resultTree = tree ?? nil();
    (resultTree.sourceRoot?._treeContext ?? parser.context).opts.trivia = trivia;

    return {
      tree: resultTree,
      lexerResult,
      errors: parser.errors,
      trivia,
      warnings: []
    };
  }

  /**
   * @todo Implement content assist for the new parser
   */
  suggest(_text: string, _init: { offset: number; rule?: CssRules }): SyntacticContentAssistSuggestion[] {
    return [];
  }
}
