import { type IToken, type CstNode, Lexer } from 'chevrotain';
import { createLexerDefinition } from '@jesscss/css-parser';
import type { ConditionalPick } from 'type-fest';
import type { Rules, IParseResult } from '@jesscss/core';

import { scssFragments, scssTokens } from './scssTokens.js';
import { ScssActionsParser, type ScssParserConfig, type TokenMap } from './scssActionsParser.js';
import { ScssErrorMessageProvider } from './scssErrorMessageProvider.js';

export * from './scssActionsParser.js';
export * from './scssTokens.js';

const errorMessageProvider = new ScssErrorMessageProvider();

export type ScssRules = keyof ConditionalPick<ScssActionsParser, () => CstNode>;

/**
 * Public convenience wrapper around the Chevrotain lexer + actions parser.
 * Mirrors `@jesscss/less-parser` API shape.
 */
export class Parser {
  lexer: Lexer;
  parser: ScssActionsParser;

  constructor(config: ScssParserConfig = {}) {
    config = {
      errorMessageProvider,
      skipValidations: process.env.TEST !== 'true',
      ...config
    };

    const { lexer, T } = createLexerDefinition(scssFragments(), scssTokens());
    this.lexer = new Lexer(lexer, {
      ensureOptimizations: true,
      skipValidations: process.env.TEST !== 'true'
    });
    this.parser = new ScssActionsParser(lexer, T as TokenMap, config);

    // Keep method stable when passed around.
    this.parse = this.parse.bind(this);
  }

  parse(text: string): IParseResult<Rules>;
  parse(text: string, rule: 'stylesheet', ...args: Parameters<ScssActionsParser['stylesheet']>): IParseResult<Rules>;
  parse<T extends ScssRules = ScssRules>(text: string, rule?: T, ...args: Parameters<ScssActionsParser[T]>): IParseResult;
  parse<T extends ScssRules = ScssRules>(
    text: string,
    rule: T = 'stylesheet' as T,
    ...args: Parameters<ScssActionsParser[T]>
  ): IParseResult {
    const parser = this.parser;
    const lexerResult = this.lexer.tokenize(text);
    const lexedTokens: IToken[] = lexerResult.tokens;
    parser.input = lexedTokens;
    const tree = parser[rule](...args);
    return { tree, lexerResult, errors: parser.errors, warnings: [] };
  }
}