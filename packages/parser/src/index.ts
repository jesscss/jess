import { IToken, Lexer } from 'chevrotain'
import { Tokens, Fragments } from './jessTokens'
import { createLexer, IParseResult } from '@jesscss/css-parser'
import { JessParser } from './jessParser'

export * from './jessParser'
export * from './jessTokens'

export class Parser {
  lexer: Lexer
  parser: JessParser

  constructor() {
    const { lexer, tokens, T } = createLexer(Fragments, Tokens)
    this.lexer = lexer
    this.parser = new JessParser(tokens, T)
  }

  parse(text: string): IParseResult<JessParser> {
    const parser = this.parser
    const lexerResult = this.lexer.tokenize(text)
    const lexedTokens: IToken[] = lexerResult.tokens
    parser.input = lexedTokens
    const cst = parser.root()

    return { cst, lexerResult, parser }
  }
}
