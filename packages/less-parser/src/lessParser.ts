import { Lexer, type IToken, type IRecognitionException } from 'chevrotain';
import { lessTokens, lessFragments } from './lessTokens.js';
import { createLexerDefinition } from '@jesscss/css-parser';
import { LessRecursiveParser, type LessParserConfig, type TokenMap } from './lessRecursiveParser.js';
import { nil, type Node, type Rules, type IParseResult, type TreeContext } from '@jesscss/core';

export type LessRules = keyof {
  [K in keyof LessRecursiveParser as LessRecursiveParser[K] extends (...args: any[]) => Node ? K : never]: true;
};

export type SyntacticContentAssistSuggestion = {
  nextTokenType: string;
  nextTokenLabel?: string;
  ruleStack: string[];
};

/**
 * Cached lexer + parser singletons. Chevrotain initialization (~500ms)
 * only happens once — config changes are applied via instance properties
 * before each parse.
 */
let cachedLexer: Lexer | undefined;
let cachedParser: LessRecursiveParser | undefined;
let cachedTokenMap: TokenMap | undefined;

function getSharedLexerAndParser(config: LessParserConfig): { lexer: Lexer; parser: LessRecursiveParser } {
  if (!cachedLexer || !cachedParser) {
    const { lexer, T } = createLexerDefinition(
      lessFragments(),
      lessTokens()
    );
    cachedTokenMap = T;
    cachedLexer = new Lexer(lexer, {
      ensureOptimizations: true,
      skipValidations: process.env.TEST !== 'true'
    });
    cachedParser = new LessRecursiveParser(cachedTokenMap, config);
  }
  // Apply per-parse config to the cached parser instance
  const {
    looseMode = true,
    leakyRules = true,
    mathMode = 'parens-division',
    wrapOuterExpressions = true,
    legacyMode = looseMode
  } = config;
  cachedParser.looseMode = looseMode;
  cachedParser.leakyRules = leakyRules;
  cachedParser.mathMode = mathMode;
  cachedParser.wrapOuterExpressions = wrapOuterExpressions;
  cachedParser.legacyMode = legacyMode;

  return { lexer: cachedLexer, parser: cachedParser };
}

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
    const shared = getSharedLexerAndParser(config);
    this.lexer = shared.lexer;
    this.parser = shared.parser;
    this.parse = this.parse.bind(this);
  }

  parse(text: string): IParseResult<Rules>;
  parse(text: string, rule: 'stylesheet'): IParseResult<Rules>;
  parse(text: string, rule: 'stylesheet', options: { context?: TreeContext }): IParseResult<Rules>;
  parse(text: string, rule?: LessRules, options?: { context?: TreeContext }): IParseResult;
  parse(text: string, rule: LessRules = 'stylesheet', options?: { context?: TreeContext }): IParseResult {
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
      throw new Error(`Unknown parser rule: ${rule}`);
    }
    const tree = ruleMethod.call(parser);
    const trivia = (parser as LessRecursiveParser & { trivia: IParseResult['trivia'] }).trivia;
    parser.context.opts.trivia = trivia;
    const resultTree = tree ?? nil();
    (resultTree.sourceRoot?._treeContext ?? parser.context).opts.trivia = trivia;

    const warnings = [...parser.warnings];

    return {
      tree: resultTree,
      lexerResult,
      errors: parser.errors,
      trivia,
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
