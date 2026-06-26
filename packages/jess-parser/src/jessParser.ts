import { Lexer, type IRecognitionException } from 'chevrotain';
import { createLexerDefinition } from '@jesscss/css-parser';
import { nil, type Node, type Rules, type IParseResult, type TreeContext } from '@jesscss/core';

import { jessFragments, jessTokens } from './jessTokens.js';
import { JessRecursiveParser, type JessParserConfig, type JessTokenMap } from './jessRecursiveParser.js';

export type JessRules = keyof {
  [K in keyof JessRecursiveParser as JessRecursiveParser[K] extends (...args: any[]) => Node ? K : never]: true;
};

export type SyntacticContentAssistSuggestion = {
  nextTokenType: string;
  nextTokenLabel?: string;
  ruleStack: string[];
};

export class JessParser {
  lexer: Lexer;
  parser: JessRecursiveParser;

  constructor(config: JessParserConfig = {}) {
    const { lexer, T } = createLexerDefinition(
      jessFragments(),
      jessTokens()
    );
    this.lexer = new Lexer(lexer, {
      ensureOptimizations: true,
      skipValidations: process.env.TEST !== 'true'
    });
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    this.parser = new JessRecursiveParser(T as JessTokenMap, config);
    this.parse = this.parse.bind(this);
  }

  parse(text: string): IParseResult<Rules>;
  parse(text: string, rule: 'stylesheet'): IParseResult<Rules>;
  parse(text: string, rule?: JessRules, options?: { context?: TreeContext }): IParseResult;
  parse(text: string, rule: JessRules = 'stylesheet', options?: { context?: TreeContext }): IParseResult {
    const parser = this.parser;
    const lexerResult = this.lexer.tokenize(text);
    parser.warnings = [];
    if (options?.context) {
      parser.context = options.context;
    }
    parser.context.opts.trivia = undefined;
    parser.input = lexerResult.tokens;
    const ruleMethod = parser[rule];
    if (typeof ruleMethod !== 'function') {
      throw new Error(`Unknown rule: ${rule}`);
    }
    const tree = ruleMethod.call(parser);
    const trivia = (parser as JessRecursiveParser & { trivia: IParseResult['trivia'] }).trivia;
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

  suggest(_text: string, _init: { offset: number; rule?: JessRules }): SyntacticContentAssistSuggestion[] {
    return [];
  }
}
