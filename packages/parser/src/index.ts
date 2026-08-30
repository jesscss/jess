import { IToken, Lexer } from 'chevrotain'
import { Tokens, Fragments } from './jessTokens'
import { createTokens, IParseResult } from '@jesscss/css-parser'
import { JessParser } from './jessParser'

export * from './jessParser'
export * from './jessTokens'

export class Parser {
  lexer: Lexer
  parser: JessParser

  constructor() {
    const { tokens, T } = createTokens(Fragments, Tokens)
    /** 
     * @todo
     * Make a multi-mode lexer for better JavaScript parsing?
     * At the least, we could do multi-mode to properly
     * process template strings `` 
     */
    this.lexer = new Lexer(tokens, {
      ensureOptimizations: true,
      skipValidations: process.env['JESS_TESTING_MODE'] !== 'true'
    })
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
