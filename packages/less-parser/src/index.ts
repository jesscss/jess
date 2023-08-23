import type { IToken } from 'chevrotain'
import { Lexer } from 'chevrotain'
import { lessTokens, lessFragments } from './lessTokens'
import type { IParseResult } from '@jesscss/css-parser'
import { createLexerDefinition } from '@jesscss/css-parser'
import { LessParser, type LessParserConfig, type TokenMap } from './lessParser'
import { LessErrorMessageProvider } from './lessErrorMessageProvider'

export * from './lessParser'
export * from './lessTokens'

const errorMessageProvider = new LessErrorMessageProvider()

export class Parser {
  lexer: Lexer
  parser: LessParser

  constructor(
    config: LessParserConfig = {}
  ) {
    config = {
      errorMessageProvider,
      ...config
    }
    const { lexer, T } = createLexerDefinition(lessFragments(), lessTokens())

    this.lexer = new Lexer(lexer, {
      ensureOptimizations: true,
      skipValidations: process.env.TEST !== 'true'
    })
    this.parser = new LessParser(lexer, T as TokenMap, config)
  }

  parse(text: string): IParseResult<LessParser> {
    const parser = this.parser
    const lexerResult = this.lexer.tokenize(text)
    const lexedTokens: IToken[] = lexerResult.tokens
    parser.input = lexedTokens
    const cst = parser.stylesheet()

    return { cst, lexerResult, parser }
  }
}