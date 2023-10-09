import { EmbeddedActionsParser, type IToken } from 'chevrotain'

import {
  type TreeContext,
  type LocationInfo
} from '@jesscss/core'

/** Apply this label to tokens you wish to skip during parsing consideration */
export const SKIPPED_LABEL = 'Skipped'
/** The name of the whitespace token */
export const WS_NAME = 'WS'

/**
 * A parser that can make decisions based on whitespace,
 * yet doesn't _require_ parsing whitespace in the main
 * token stream.
 */
export class AdvancedActionsParser extends EmbeddedActionsParser {
  /** Indexed by the startOffset of the next token it precedes */
  preSkippedTokenMap: Map<number, IToken[]>
  postSkippedTokenMap: Map<number, IToken[]>
  usedSkippedTokens: Set<IToken[]>

  context: TreeContext
  locationStack: LocationInfo[]
  captureStack: number[]
  originalInput: IToken[]

  /** Exposed from Chevrotain */
  currIdx: number

  /** Separate skipped tokens into a new map */
  // @ts-expect-error - It's defined in Chevrotain as a data property
  set input(value: IToken[]) { // eslint-disable-line accessor-pairs
    const preSkippedTokenMap = this.preSkippedTokenMap = new Map<number, IToken[]>()
    const postSkippedTokenMap = this.postSkippedTokenMap = new Map<number, IToken[]>()
    const inputTokens: IToken[] = []
    let valueLength = value.length
    let prevToken: IToken | undefined
    for (let i = 0; i < valueLength; i++) {
      const token = value[i]!
      let nextToken: IToken | undefined
      /** Find the next non-skipped token */
      for (let j = i + 1; j < valueLength; j++) {
        nextToken = value[j]!
        if (nextToken.tokenType.LABEL !== SKIPPED_LABEL) {
          break
        }
      }
      const beforeIndex = nextToken?.startOffset ?? Infinity
      if (token.tokenType.LABEL === SKIPPED_LABEL) {
        let tokens = preSkippedTokenMap.get(beforeIndex)
        if (tokens) {
          tokens.push(token)
        } else {
          tokens = [token]
          preSkippedTokenMap.set(beforeIndex, [token])
        }
        if (prevToken) {
          postSkippedTokenMap.set(prevToken.endOffset!, tokens)
        }
      } else {
        prevToken = token
        inputTokens.push(token)
      }
    }
    this.usedSkippedTokens = new Set()
    this.originalInput = value
    super.input = inputTokens
  }

  /**
   * Used in a GATE.
   * Determine if there is white-space before the next token
   */
  hasWS() {
    let startOffset = this.LA(1).startOffset
    const skipped = this.preSkippedTokenMap.get(startOffset)
    if (!skipped) {
      return false
    }
    return !!skipped.find(token => token.tokenType.name === WS_NAME)
  }

  /**
   * Used in a GATE.
   * Affirms that there is NOT white space or comment before next token
   */
  noSep(offset: number = 0) {
    let startOffset = this.LA(1 + offset).startOffset
    return !this.preSkippedTokenMap.get(startOffset)
  }

  protected startRule() {
    if (!this.RECORDING_PHASE) {
      let { startOffset, startLine, startColumn } = this.LA(1)
      let location: LocationInfo = [startOffset, startLine!, startColumn!, NaN, NaN, NaN]
      this.locationStack.push(location)
      return location
    }
  }

  /** Should only be called when not in recording phase */
  protected endRule() {
    let { endOffset, endLine, endColumn } = this.LA(-1)
    let location = this.locationStack.pop()!
    location[3] = endOffset!
    location[4] = endLine!
    location[5] = endColumn!
    return location
  }

  /** @note might not need these */
  // protected startCapture() {
  //   if (!this.RECORDING_PHASE) {
  //     let idx = this.currIdx
  //     this.startRule()
  //     this.captureStack.push(idx)
  //   }
  // }

  // protected endCapture(): [string, LocationInfo] {
  //   let location = this.endRule()
  //   let prevIdx = this.captureStack.pop()!
  //   let currIdx = this.currIdx
  //   let input = this.originalInput
  //   let tokenStr = ''
  //   let token: IToken | undefined

  //   for (let i = prevIdx; i <= currIdx; i++) {
  //     token = input[i]!
  //     if (this.preSkippedTokenMap.has(token.startOffset)) {
  //       for (let skipped of this.preSkippedTokenMap.get(token.startOffset)!) {
  //         tokenStr += skipped.image
  //       }
  //     }
  //     tokenStr += token.image
  //   }
  //   if (token && this.postSkippedTokenMap.has(token.endOffset!)) {
  //     for (let skipped of this.postSkippedTokenMap.get(token.endOffset!)!) {
  //       tokenStr += skipped.image
  //     }
  //   }
  //   return [tokenStr, location]
  // }

  protected getLocationInfo(loc: IToken): LocationInfo {
    const {
      startOffset,
      startLine,
      startColumn,
      endOffset,
      endLine,
      endColumn
    } = loc
    /** Assert that, in our case, tokens will have these properties */
    return [startOffset, startLine!, startColumn!, endOffset!, endLine!, endColumn!]
  }

  protected isToken(node: any): node is IToken {
    return Boolean(node && 'tokenType' in node)
  }
}