import { type ILexingResult, Lexer, type IRecognitionException } from 'chevrotain'
import { cssTokens, cssFragments } from './cssTokens'
import { type TokenMap, type CssParserConfig, CssActionsParser } from './cssActionsParser'
import { createLexerDefinition } from './util'
import { CssErrorMessageProvider } from './cssErrorMessageProvider'
import type { ConditionalPick } from 'type-fest'
import { type Node, type Root } from '@jesscss/core'

export interface IParseResult<T extends Node = Node> {
  lexerResult: ILexingResult
  errors: IRecognitionException[]
  tree: T
}

const errorMessageProvider = new CssErrorMessageProvider()

export type CssRules = keyof ConditionalPick<CssActionsParser, () => Node>

/**
 * If we're not extending the CSS parser,
 * this is the friendlier interface for returning
 * a CST, as it assigns tokens to the parser automatically.
 */
export class CssParser {
  lexer: Lexer
  parser: CssActionsParser

  /**
   * @note `recoveryEnabled` should be set to true for
   * linting and language services.
   */
  constructor(
    config: CssParserConfig = {}
  ) {
    config = {
      errorMessageProvider,
      /**
       * Override this if you want to omit legacy IE syntax
       * and ancient CSS hacks.
       * @todo Allow overriding when parsing a single rule.
       */
      legacyMode: true,
      skipValidations: process.env.TEST !== 'true',
      ...config
    }
    const { lexer, T } = createLexerDefinition(cssFragments(), cssTokens())
    this.lexer = new Lexer(lexer, {
      ensureOptimizations: true,
      // Always run the validations during testing (dev flows).
      // And avoid validation during productive flows to reduce the Lexer's startup time.
      skipValidations: process.env.TEST !== 'true'
    })
    this.parser = new CssActionsParser(lexer, T as TokenMap, config)
  }

  parse(text: string): IParseResult<Root>
  parse(text: string, rule: 'stylesheet'): IParseResult<Root>
  parse(text: string, rule?: CssRules): IParseResult
  parse(text: string, rule: CssRules = 'stylesheet'): IParseResult {
    const parser = this.parser
    const lexerResult = this.lexer.tokenize(text)
    const lexedTokens = lexerResult.tokens
    parser.input = lexedTokens
    const tree = parser[rule]() as Node

    return {
      tree,
      lexerResult,
      errors: parser.errors
    }
  }
}