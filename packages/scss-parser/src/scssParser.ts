import { Lexer } from 'chevrotain';
import { scssTokens, scssFragments } from './scssTokens.js';
import { createLexerDefinition } from '@jesscss/css-parser';
import { ScssRecursiveParser, type ScssParserConfig, type TokenMap } from './scssRecursiveParser.js';
import type { Node, Rules, IParseResult, TreeContext } from '@jesscss/core';
import { type IToken, MismatchedTokenError } from '@jesscss/parser-runtime';

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
  suggest(text: string, init: { offset: number; rule?: ScssRules }): SyntacticContentAssistSuggestion[] {
    return [];
  }
}
