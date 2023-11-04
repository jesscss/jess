import { type IToken, type CstNode, Lexer } from 'chevrotain'
import { lessTokens, lessFragments } from './lessTokens'
import type { IParseResult } from '@jesscss/css-parser'
import { createLexerDefinition } from '@jesscss/css-parser'
import { LessActionsParser, type LessParserConfig, type TokenMap } from './lessActionsParser'
import { LessErrorMessageProvider } from './lessErrorMessageProvider'
import type { ConditionalPick } from 'type-fest'
import type { Root } from '@jesscss/core'

export * from './lessActionsParser'
export * from './lessTokens'

const errorMessageProvider = new LessErrorMessageProvider()

type LessRules = keyof ConditionalPick<LessActionsParser, () => CstNode>

export class Parser {
  lexer: Lexer
  /** @todo - return Jess AST as parser */
  parser: LessActionsParser

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
    this.parser = new LessActionsParser(lexer, T as TokenMap, config)
    /** Not sure why this is necessary, but Less tests were a problem */
    this.parse = this.parse.bind(this)
  }

  parse(text: string, rule: 'stylesheet', ...args: Parameters<LessActionsParser['stylesheet']>): IParseResult<Root>
  parse<T extends LessRules = LessRules>(text: string, rule?: T, ...args: Parameters<LessActionsParser[T]>): IParseResult
  parse<T extends LessRules = LessRules>(text: string, rule: T = 'stylesheet' as T, ...args: Parameters<LessActionsParser[T]>): IParseResult {
    const parser = this.parser
    const lexerResult = this.lexer.tokenize(text)
    const lexedTokens: IToken[] = lexerResult.tokens
    parser.input = lexedTokens
    // @ts-expect-error - This is fine
    const tree = parser[rule](args)

    let contents: string[] | undefined

    if (!lexerResult.errors.length && !parser.errors.length) {
      contents = text.split('\n')
    }

    return { tree, contents, lexerResult, errors: parser.errors }
  }
}