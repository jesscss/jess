import { type IToken, type CstNode, Lexer } from 'chevrotain'
import { lessTokens, lessFragments } from './lessTokens'
import type { IParseResult } from '@jesscss/css-parser'
import { createLexerDefinition } from '@jesscss/css-parser'
import { LessParser, type LessParserConfig, type TokenMap } from './lessParser'
import { LessErrorMessageProvider } from './lessErrorMessageProvider'
import type { ConditionalPick } from 'type-fest'

export * from './lessParser'
export * from './lessTokens'

const errorMessageProvider = new LessErrorMessageProvider()

type LessRules = keyof ConditionalPick<LessParser, () => CstNode>

export class Parser {
  lexer: Lexer
  /** @todo - return Jess AST as parser */
  parser: LessParser

  constructor(
    config: LessParserConfig = {}
  ) {
    config = {
      errorMessageProvider,
      /**
       * Override this if you want a stricter Less/CSS parser.
       * @todo - Allow overriding when parsing a single rule.
       */
      looseMode: true,
      skipValidations: process.env.TEST !== 'true',
      ...config
    }
    const { lexer, T } = createLexerDefinition(lessFragments(), lessTokens())

    this.lexer = new Lexer(lexer, {
      ensureOptimizations: true,
      skipValidations: process.env.TEST !== 'true'
    })
    this.parser = new LessParser(lexer, T as TokenMap, config)
    /** Not sure why this is necessary, but Less tests were a problem */
    this.parse = this.parse.bind(this)
  }

  parse<T extends LessRules = LessRules>(text: string, rule: T = 'stylesheet' as T, ...args: Parameters<LessParser[T]>): IParseResult<LessParser> {
    const parser = this.parser
    const lexerResult = this.lexer.tokenize(text)
    const lexedTokens: IToken[] = lexerResult.tokens
    parser.input = lexedTokens
    // @ts-expect-error - This is fine
    const cst = parser[rule](args)

    return { cst, lexerResult, errors: parser.errors }
  }
}