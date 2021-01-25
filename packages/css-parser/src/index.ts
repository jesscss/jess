import { IToken, Lexer, ILexingResult } from 'chevrotain'
import { Tokens, Fragments } from './cssTokens'
import { CssParser, CstNode } from './cssParser'
import { createTokens } from './util'

export * from './cssTokens'
export * from './util'
export * from './cssParser'

export interface IParseResult<T extends CssParser = CssParser> {
  cst: CstNode
  lexerResult: ILexingResult
  parser: T
}

export class Parser {
  lexer: Lexer
  parser: CssParser

  constructor() {
    const { tokens, T } = createTokens(Fragments, Tokens)
    this.lexer = new Lexer(tokens, {
      ensureOptimizations: true,
      // Always run the validations during testing (dev flows).
      // And avoid validation during productive flows to reduce the Lexer's startup time.
      skipValidations: process.env['JESS_TESTING_MODE'] !== 'true'
    })
    this.parser = new CssParser(tokens, T)
  }

  parse(text: string): IParseResult {
    const parser = this.parser
    const lexerResult = this.lexer.tokenize(text)
    const lexedTokens: IToken[] = lexerResult.tokens
    parser.input = lexedTokens
    const cst = parser.root()

    return { cst, lexerResult, parser }
  }
}
