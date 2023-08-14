import type { IToken, ILexingResult, CstNode } from 'chevrotain'
import { Lexer } from 'chevrotain'
import { cssTokens, cssFragments } from './cssTokens'
import type { TokenMap } from './cssParser'
import { CssParser } from './cssParser'
import { createLexerDefinition } from './util'

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
    const { lexer, T } = createLexerDefinition(cssFragments(), cssTokens())
    this.lexer = new Lexer(lexer, {
      ensureOptimizations: true,
      // Always run the validations during testing (dev flows).
      // And avoid validation during productive flows to reduce the Lexer's startup time.
      skipValidations: process.env.TEST !== 'true'
    })
    this.parser = new CssParser(lexer, T as TokenMap)
  }

  parse(text: string): IParseResult {
    const parser = this.parser
    const lexerResult = this.lexer.tokenize(text)
    const lexedTokens: IToken[] = lexerResult.tokens
    parser.skippedTokens = lexerResult.groups.Skipped
    parser.input = lexedTokens
    const cst = parser.stylesheet()

    return { cst, lexerResult, parser }
  }
}