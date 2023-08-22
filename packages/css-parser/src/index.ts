import type { IToken, ILexingResult, CstNode } from 'chevrotain'
import { Lexer } from 'chevrotain'
import { cssTokens, cssFragments } from './cssTokens'
import { CssParser } from './cssParser'
import type { TokenMap, CssParserConfig } from './cssParser'
import { createLexerDefinition } from './util'
import { CssErrorMessageProvider } from './cssErrorMessageProvider'

export * from './cssTokens'
export * from './util'
export * from './cssParser'
export * from './cssErrorMessageProvider'

export interface IParseResult<T extends CssParser = CssParser> {
  cst: CstNode
  lexerResult: ILexingResult
  parser: T
}

const errorMessageProvider = new CssErrorMessageProvider()

export class Parser {
  lexer: Lexer
  parser: CssParser

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
       * Override this if you want a stricter CSS parser.
       * You can also override when parsing using a single rule.
       */
      loose: true,
      ...config
    }
    const { lexer, T } = createLexerDefinition(cssFragments(), cssTokens())
    this.lexer = new Lexer(lexer, {
      ensureOptimizations: true,
      // Always run the validations during testing (dev flows).
      // And avoid validation during productive flows to reduce the Lexer's startup time.
      skipValidations: process.env.TEST !== 'true'
    })
    this.parser = new CssParser(lexer, T as TokenMap, config)
  }

  parse(text: string): IParseResult {
    const parser = this.parser
    const lexerResult = this.lexer.tokenize(text)
    const lexedTokens: IToken[] = lexerResult.tokens
    parser.input = lexedTokens
    const cst = parser.stylesheet()

    return { cst, lexerResult, parser }
  }
}