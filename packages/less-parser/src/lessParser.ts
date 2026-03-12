import { Lexer } from 'chevrotain';
import { lessTokens, lessFragments } from './lessTokens.js';
import { createLexerDefinition } from '@jesscss/css-parser';
import { LessRecursiveParser, type LessParserConfig, type TokenMap } from './lessRecursiveParser.js';
import type { Node, Rules, IParseResult, TreeContext } from '@jesscss/core';
import { type IToken, MismatchedTokenError } from '@jesscss/parser-runtime';

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
    parser.input = lexerResult.tokens as IToken[];
    let tree: Node | undefined;
    try {
      tree = (parser as any)[rule]() as Node;
    } catch (e: any) {
      if (e && e.token) {
        parser.errors.push(e);
      } else {
        throw e;
      }
    }

    // Check for unconsumed tokens (partial parse)
    if (parser.errors.length === 0 && (parser as any).pos < (parser as any).tokens.length) {
      const unconsumed = (parser as any).tokens[(parser as any).pos] as IToken;
      parser.errors.push(new MismatchedTokenError(
        unconsumed,
        { name: 'EOF', PATTERN: undefined as any },
        ['stylesheet']
      ));
    }

    const warnings = [...parser.warnings];

    return {
      tree: tree!,
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
