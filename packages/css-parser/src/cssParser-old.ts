import { EmbeddedActionsParser } from 'chevrotain'
import type {
  TokenType,
  IParserConfig,
  BaseParser,
  IRuleConfig,
  IToken,
  ParserMethod
} from 'chevrotain'
import type { TokenMap } from './util'
import root from './productions/root'
import atRules from './productions/atRules'
import blocks from './productions/blocks'
import selectors from './productions/selectors'
import declarations from './productions/declarations'
import values from './productions/values'

export type { IToken }

export type Rule<T = CstNode, F extends (...args: any[]) => T = (...args: any[]) => T> = ParserMethod<Parameters<F>, ReturnType<F>>

/**
 * CST structure as follows
 *
 * @example
 * ```
 * {
 *   name: 'root'
 *   children: [
 *     {
 *       name: 'AtRule',
 *       children: [...]
 *       location: {...}
 *     },
 *     {
 *       name: 'WS',
 *       value: '\n',
 *       location: {...}
 *     }
 *   ]
 *   location: {...}
 * }
 * ```
 */
export interface ILocationInfo {
  startOffset: number
  startLine: number
  startColumn: number
  endOffset: number
  endLine: number
  endColumn: number
}

export type CstChild = CstNode | IToken | undefined

export interface CstNode {
  name: string
  children: CstChild[]
  location?: ILocationInfo
}

export class CssParser extends EmbeddedActionsParser {
  T: TokenMap
  _: (idx?: number) => IToken | undefined

  option: BaseParser['option']
  consume: BaseParser['consume']

  /** Productions */
  root: Rule
  primary: Rule<CstChild[]>
  rule: Rule
  atRule: Rule
  knownAtRule: Rule
  unknownAtRule: Rule
  atImport: Rule
  atMedia: Rule
  atSupports: Rule
  atNested: Rule
  atNonNested: Rule

  /** @media */
  mediaQueryList: Rule
  mediaQuery: Rule
  mediaCondition: Rule
  mediaFeature: Rule
  mediaAnd: Rule

  /** blocks */
  qualifiedRule: Rule
  testQualifiedRule: Rule<void>
  testQualifiedRuleExpression: Rule<void>
  block: Rule
  curlyBlock: Rule
  customBlock: Rule
  customPreludeBlock: Rule

  /** Selector rules */
  selectorList: Rule
  complexSelector: Rule
  combinatorSelector: Rule
  compoundSelector: Rule
  simpleSelector: Rule
  pseudoSelector: Rule
  attrSelector: Rule
  attrIdent: Rule
  nameSelector: Rule

  /** declarations */
  declaration: Rule
  customDeclaration: Rule
  property: Rule
  customProperty: Rule

  /** expressions */
  expressionList: Rule
  expression: Rule

  /** values */
  value: Rule
  atomicValue: Rule
  customValue: Rule
  customPrelude: Rule
  customValueOrSemi: Rule
  anyToken: Rule
  extraTokens: Rule

  protected currIdx: number

  // declare SUBRULE: SubruleMethodOpts<CssParser>['SUBRULE']

  constructor(
    tokens: TokenType[],
    T: TokenMap,
    config: IParserConfig = {
      maxLookahead: 1,
      recoveryEnabled: true
    }
  ) {
    super(tokens, config)
    const $ = this
    $.T = T

    root.call($, $)
    atRules.call($, $)
    blocks.call($, $)
    selectors.call($, $)
    declarations.call($, $)
    values.call($, $)

    /** If this is extended, don't perform self-analysis twice */
    if ($.constructor === CssParser) {
      $.performSelfAnalysis()
    }
  }

  /** Capture location information for CST nodes */
  public CAPTURE<T extends () => any>(func: T) {
    if (!this.RECORDING_PHASE) {
      const startIndex = this.currIdx + 1
      const result = func()
      const endIndex = this.currIdx

      if (result?.name) {
        const startToken = this.input[startIndex]
        const endToken = this.input[endIndex]

        if (startToken && endToken) {
          const { startOffset, startColumn, startLine } = startToken
          const { endOffset, endColumn, endLine } = endToken

          result.location = {
            startOffset,
            startColumn,
            startLine,
            endOffset,
            endColumn,
            endLine
          }
        }
      }
      return result
    }
    return func()
  }

  protected RULE<T = any, F extends (...args: any[]) => T = (...args: any[]) => T>(
    name: string, impl: F, config?: IRuleConfig<ReturnType<F>>
  ) {
    return super.RULE<F>(
      name,
      ((...args) => this.CAPTURE(() => impl(...args))) as F,
      config
    )
  }

  protected OVERRIDE_RULE<T = any, F extends (...args: any[]) => T = (...args: any[]) => T>(
    name: string,
    impl: F,
    config?: IRuleConfig<ReturnType<F>>
  ) {
    return super.OVERRIDE_RULE<F>(
      name,
      ((...args: any[]) => this.CAPTURE(() => impl(...args))) as F,
      config
    )
  }
}