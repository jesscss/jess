import {
  CstParser,
  EOF,
  isRecognitionException,
  EarlyExitException,
  NoViableAltException,
  type IOrAlt,
  type OrMethodOpts,
  type SubruleMethodOpts,
  type IToken,
  type CstNode,
  type TokenType,
  type ConsumeMethodOpts,
  type CstNodeLocation,
  type IRecognitionException
} from 'chevrotain'

import type { ParserMethodInternal } from 'chevrotain/src/parse/parser/types'

import clone from 'lodash-es/clone'

/** copied from 'chevrotain/src/parse/grammar/keys'  */
export const BITS_FOR_METHOD_TYPE = 4
export const BITS_FOR_OCCURRENCE_IDX = 8
export const OR_IDX = 1 << BITS_FOR_OCCURRENCE_IDX

export interface IParserState {
  errors: IRecognitionException[]
  lexerState: any
  RULE_STACK: number[]
  CST_STACK: CstNode[]
}

/** Apply this label to tokens you wish to skip during parsing consideration */
export const SKIPPED_LABEL = 'Skipped'
/** The name of the whitespace token */
export const WS_NAME = 'WS'

const BACKTRACKING_ERROR = 'Error during backtracking'

export type AdvancedCstNode = CstNode & {
  childrenStream: Array<AdvancedCstNode | IToken>
}

export type OrAdvancedMethodOpts<T> = OrMethodOpts<T> & {
  CONTINUE_ON_ERROR?: boolean
}

/**
 * This enhances Chevrotain's CstParser with a few extra features:
 *   1. It auto-skips tokens passed in (like comments and whitespace)
 *      so they aren't considered during parsing, yet are still accessible
 *      to make parsing decisions, and they'll be added to the CstNode.
 *   2. It adds a `childrenStream` property to each CstNode which is a linear
 *      representation of captured tokens and CstNodes.
 *   3. It has more advanced backtracking along with try-parsing functionality.
 */
export class AdvancedCstParser extends CstParser {
  skippedTokens: Map<number, IToken[]>

  /** Start exposing private Chevrotain API */
  CST_STACK: AdvancedCstNode[]
  currIdx: number
  isBackTrackingStack: number[]
  outputCst: boolean
  _errors: IRecognitionException[]
  RULE_STACK: number[]
  isTryingAlt: boolean
  trySubRuleCache: WeakMap<ParserMethodInternal<any[], any>, { args: any[] }>

  getLaFuncFromCache: (key: number) => (alts: Array<IOrAlt<any>>) => number

  getKeyForAutomaticLookahead: (
    dslMethodIdx: number,
    occurrence: number
  ) => number

  isBackTracking: () => boolean

  setInitialNodeLocation: (node: CstNode) => void

  setNodeLocationFromToken: (
    nodeLocation: CstNodeLocation,
    locationInformation: CstNodeLocation,
  ) => void

  setNodeLocationFromNode: (
    nodeLocation: CstNodeLocation,
    locationInformation: CstNodeLocation,
  ) => void
  /** End exposing private Chevrotain API */

  /** Used by backtracking and try-parse */
  saveRecogState(): IParserState {
    const savedRuleStack = clone(this.RULE_STACK)
    return {
      errors: this.isBackTracking() ? [] : this.errors,
      lexerState: this.currIdx,
      RULE_STACK: savedRuleStack,
      CST_STACK: this.CST_STACK
    }
  }

  /** Used by backtracking and try-parse */
  reloadRecogState(newState: IParserState) {
    if (!this.isBackTracking()) {
      this.errors = newState.errors
    }
    this.currIdx = newState.lexerState
    this.RULE_STACK = newState.RULE_STACK
  }

  /** Suppress error recording when backtracking */
  raiseEarlyExitException(
    occurrence: number,
    prodType: any,
    userDefinedErrMsg: string | undefined
  ) {
    if (this.isBackTracking()) {
      throw new EarlyExitException(BACKTRACKING_ERROR, this.LA(1), this.LA(0))
    }
    // @ts-expect-error - This exists
    super.raiseEarlyExitException(occurrence, prodType, userDefinedErrMsg)
  }

  raiseNoAltException(
    occurrence: number,
    errMsgTypes: string | undefined
  ) {
    if (this.isBackTracking()) {
      throw new NoViableAltException(
        BACKTRACKING_ERROR,
        this.LA(1),
        this.LA(0)
      )
    }
    // @ts-expect-error - This exists
    super.raiseNoAltException(occurrence, errMsgTypes)
  }

  subRuleInternalError(
    e: any,
    options: SubruleMethodOpts<unknown[]> | undefined,
    ruleName: string
  ) {
    if (this.isBackTracking()) {
      throw e
    }
    // @ts-expect-error - This exists
    super.subRuleInternalError(e, options, ruleName)
  }

  consumeInternalError(
    tokType: TokenType,
    nextToken: IToken,
    options: ConsumeMethodOpts | undefined
  ) {
    if (this.isBackTracking()) {
      const backtrackingError = new Error()
      backtrackingError.name = 'MismatchedTokenException'
      throw backtrackingError
    }
    // @ts-expect-error - This exists
    super.consumeInternalError(tokType, nextToken, options)
  }

  BACKTRACK<T>(grammarRule: (...args: any[]) => T, args?: any[]): () => boolean {
    const self = this
    return function() {
      self.isBackTrackingStack.push(1)
      const orgState = self.saveRecogState()
      try {
        // hack to enable outputting none CST values from grammar rules.
        self.outputCst = false
        grammarRule.apply(self, args!)
        return true
      } catch (e) {
        if (isRecognitionException(e as Error)) {
          return false
        } else {
          throw e
        }
      } finally {
        self.outputCst = true
        self.reloadRecogState(orgState)
        self.isBackTrackingStack.pop()
      }
    }
  }

  // orInternal<T>(
  //   altsOrOpts: Array<IOrAlt<any>> | OrAdvancedMethodOpts<unknown>,
  //   occurrence: number
  // // @ts-expect-error - `raiseNoAltException` throws an error
  // ): T {
  //   const laKey = this.getKeyForAutomaticLookahead(OR_IDX, occurrence)
  //   let alts: Array<IOrAlt<any>>
  //   let continueOnError = false
  //   if (Array.isArray(altsOrOpts)) {
  //     alts = altsOrOpts
  //   } else {
  //     alts = altsOrOpts.DEF
  //     continueOnError = altsOrOpts.CONTINUE_ON_ERROR ?? false
  //   }

  //   const laFunc = this.getLaFuncFromCache(laKey)
  //   if (continueOnError) {
  //     const altIdxesToTake = alts.map(alt => laFunc.call(this, [alt]))
  //     if (altIdxesToTake.length) {
  //       for (let i = 0; i < altIdxesToTake.length; i++) {
  //         const altIdxToTake = altIdxesToTake[i]
  //         const chosenAlternative: any = alts[altIdxToTake]
  //         const isTrying = this.isTryingAlt
  //         const orgState = this.saveRecogState()
  //         try {
  //           this.isTryingAlt = isTrying
  //           return chosenAlternative.ALT.call(this)
  //         } catch (e) {
  //           this.isTryingAlt = isTrying
  //           if (isRecognitionException(e as Error)) {
  //             this.reloadRecogState(orgState)
  //           } else {
  //             throw e
  //           }
  //         }
  //       }
  //     }
  //   } else {
  //     const altIdxToTake = laFunc.call(this, alts)
  //     if (altIdxToTake !== undefined) {
  //       const chosenAlternative: any = alts[altIdxToTake]
  //       return chosenAlternative.ALT.call(this)
  //     }
  //   }
  //   this.raiseNoAltException(
  //     occurrence,
  //     (altsOrOpts as OrMethodOpts<unknown>).ERR_MSG
  //   )
  // }

  cstPostTerminal(
    key: string,
    consumedToken: IToken
  ): void {
    if (!this.outputCst) {
      return
    }
    const rootCst = this.CST_STACK[this.CST_STACK.length - 1]
    this.addTerminalToCst(rootCst, consumedToken, key)
    this.setNodeLocationFromToken(rootCst.location!, <any>consumedToken)
  }

  cstPostNonTerminal(
    ruleCstResult: CstNode,
    ruleName: string
  ): void {
    if (!this.outputCst) {
      return
    }
    const preCstNode = this.CST_STACK[this.CST_STACK.length - 1]
    this.addNoneTerminalToCst(preCstNode, ruleName, ruleCstResult)
    this.setNodeLocationFromNode(preCstNode.location!, ruleCstResult.location!)
  }

  cstInvocationStateUpdate(fullRuleName: string): void {
    if (!this.outputCst) {
      return
    }
    const cstNode: Partial<AdvancedCstNode> = {
      name: fullRuleName,
      children: Object.create(null)
    }
    /**
     * Sets a linear stream of children CstNodes and ITokens
     * which can easily be re-serialized.
     */
    Object.defineProperty(cstNode, 'childrenStream', {
      value: []
    })

    this.setInitialNodeLocation(cstNode as CstNode)
    this.CST_STACK.push(cstNode as AdvancedCstNode)
  }

  cstFinallyStateUpdate(): void {
    if (!this.outputCst) {
      return
    }
    this.CST_STACK.pop()
  }

  addTerminalToCst(node: AdvancedCstNode, token: IToken, tokenTypeName: string) {
    node.childrenStream.push(token)
    if (node.children[tokenTypeName] === undefined) {
      node.children[tokenTypeName] = [token]
    } else {
      node.children[tokenTypeName].push(token)
    }
  }

  addNoneTerminalToCst(node: AdvancedCstNode, ruleName: string, ruleResult: any) {
    this.addTerminalToCst(node, ruleResult, ruleName)
  }

  private _consumeImplicits(key: 'pre' | 'post') {
    if (!this.outputCst) {
      return
    }
    const skipped = this.skippedTokens.get(this.currIdx + 1)
    if (skipped) {
      if (key === 'pre' || this.LA(1).tokenType === EOF) {
        skipped.forEach(token => this.cstPostTerminal(key, token))
      }
    }
  }

  consumeInternal(tokType: TokenType, idx: number, options?: ConsumeMethodOpts): IToken {
    this._consumeImplicits('pre')
    // @ts-expect-error - Yes this exists.
    const retVal = super.consumeInternal(tokType, idx, options)
    this._consumeImplicits('post')
    return retVal
  }

  /** Separate skipped tokens into a new map */
  // @ts-expect-error - It's defined in Chevrotain as a data property
  set input(value: IToken[]) { // eslint-disable-line accessor-pairs
    const skippedTokens = new Map<number, IToken[]>()
    const inputTokens: IToken[] = []
    let foundTokens: number = 0
    for (let i = 0; i < value.length; i++) {
      const token = value[i]
      if (token.tokenType.LABEL === SKIPPED_LABEL) {
        const tokens = skippedTokens.get(foundTokens) ?? []
        skippedTokens.set(foundTokens, [...tokens, token])
      } else {
        inputTokens.push(token)
        foundTokens++
      }
    }
    this.skippedTokens = skippedTokens
    super.input = inputTokens
  }

  /**
   * Used in a GATE.
   * Determine if there is white-space before the next token
   */
  hasWS() {
    const skipped = this.skippedTokens.get(this.currIdx + 1)
    if (!skipped) {
      return false
    }
    return !!skipped.find(token => token.tokenType.name === WS_NAME)
  }

  /**
   * Used in a GATE.
   * Affirms that there is NOT white space or comment before next token
   */
  noSep() {
    return !this.skippedTokens.get(this.currIdx + 1)
  }
}