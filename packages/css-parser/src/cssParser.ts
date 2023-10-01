import type { ILexingResult, CstNode } from 'chevrotain'
import { Lexer } from 'chevrotain'
import { cssTokens, cssFragments } from './cssTokens'
import { type TokenMap, type CssParserConfig, CssCstParser } from './cssCstParser'
import { type AdvancedCstNode, type IToken } from './advancedCstParser'
import { createLexerDefinition } from './util'
import { CssErrorMessageProvider } from './cssErrorMessageProvider'
import type { ConditionalPick } from 'type-fest'
import { CssCstVisitor } from './cssCstVisitor'
import { type Node } from '@jesscss/core'

export interface IParseResult<T extends CssCstParser = CssCstParser> {
  cst: AdvancedCstNode
  lexerResult: ILexingResult
  errors: T['errors']
  tree?: Node
  contents?: string[]
}

const errorMessageProvider = new CssErrorMessageProvider()

export type CssRules = keyof ConditionalPick<CssCstParser, () => CstNode>

/**
 * If we're not extending the CSS parser,
 * this is the friendlier interface for returning
 * a CST, as it assigns tokens to the parser automatically.
 */
export class CssParser {
  lexer: Lexer
  /** @todo - return Jess AST as parser */
  parser: CssCstParser
  visitor: CssCstVisitor

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
    this.parser = new CssCstParser(lexer, T as TokenMap, config)
    this.visitor = new CssCstVisitor()
  }

  parse(text: string, rule: CssRules = 'stylesheet'): IParseResult {
    const parser = this.parser
    const lexerResult = this.lexer.tokenize(text)
    const lexedTokens = lexerResult.tokens as IToken[]
    parser.input = lexedTokens
    const cst = parser[rule]() as AdvancedCstNode

    return {
      cst,
      lexerResult,
      errors: parser.errors
    }
  }

  parseTree(text: string, rule: CssRules = 'stylesheet'): IParseResult {
    const { cst, lexerResult, errors } = this.parse(text, rule)
    if (!lexerResult.errors.length && !errors.length) {
      let { parser, visitor } = this
      visitor.init(parser.skippedTokenMap)
      const tree = visitor.visit(cst)
      const contents = text.split('\n')
      return {
        cst,
        lexerResult,
        errors,
        tree,
        contents
      }
    }
    return { cst, lexerResult, errors }
  }
}