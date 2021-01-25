import { IToken, Lexer } from 'chevrotain'
import { Tokens, Fragments } from './lessTokens'
import { createTokens, IParseResult } from '@jesscss/css-parser'
import { LessParser } from './lessParser'

export * from './lessParser'
export * from './lessTokens'

export class Parser {
  lexer: Lexer
  parser: LessParser

  constructor() {
    const { tokens, T } = createTokens(Fragments, Tokens)
    this.lexer = new Lexer(tokens, {
      ensureOptimizations: true,
      skipValidations: process.env['JESS_TESTING_MODE'] !== 'true'
    })
    this.parser = new LessParser(tokens, T)
  }

  parse(text: string): IParseResult<LessParser> {
    const parser = this.parser
    const lexerResult = this.lexer.tokenize(text)
    const lexedTokens: IToken[] = lexerResult.tokens
    parser.input = lexedTokens
    const cst = parser.root()

    return { cst, lexerResult, parser }
  }
}
