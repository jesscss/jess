import { EmbeddedActionsParser, type IToken } from 'chevrotain'

import {
  type TreeContext,
  type Scope,
  type LocationInfo,
  Node,
  Comment
} from '@jesscss/core'

const { isArray } = Array

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
  initialScope: Scope
  locationStack: LocationInfo[]
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

  protected getRulesWithComments(existingRules: Node[]) {
    let rules = []
    /**
     * @todo - I think this pattern means that comments after
     * the last rule will be tossed out, so we need to figure
     * out a way to get comments when comments are the only
     * content in a file.
     */
    // let rule: Node | undefined

    for (let rule of existingRules) {
      let pre = this.getPrePost(rule.location[0]!, true)
      if (isArray(pre)) {
        let i = 0
        let item = pre[i]
        while (item) {
          if (item instanceof Node) {
            let prev = pre[i - 1]
            /** Attach whitespace before comment to comment */
            if (prev) {
              item.pre = [prev]
              pre.shift()
              i--
            }
            rules.push(item)
            pre.shift()
            i--
          }
          item = pre[++i]
        }
      }
      rule.pre = pre
      rules.push(rule)
    }
    return rules
  }

  protected getPrePost(offset: number, commentsOnly?: boolean, post?: boolean): Node['pre'] {
    let skipped = post ? this.postSkippedTokenMap.get(offset) : this.preSkippedTokenMap.get(offset)
    if (!skipped) {
      return 0
    }
    if (this.usedSkippedTokens.has(skipped)) {
      return 0
    }
    this.usedSkippedTokens.add(skipped)

    let pre: Node['pre'] = skipped.map(token => {
      let name = token.tokenType.name
      if (name === 'WS') {
        return token.image
      } else {
        return new Comment(token.image, { lineComment: name.includes('Line') }, this.getLocationInfo(token), this.context)
      }
    })
    if (commentsOnly) {
      pre = pre.filter(item => item instanceof Comment)
    }

    if (pre.length === 1 && pre[0] === ' ') {
      pre = 1
    }
    return pre
  }

  protected wrap<T extends Node = Node>(node: T, post?: boolean | 'both', commentsOnly?: boolean): T {
    if (post) {
      let endOffset = node.location[3]!
      node.post = this.getPrePost(endOffset, commentsOnly, true)
      if (post !== 'both') {
        return node
      }
    }
    let startOffset = node.location[0]!
    node.pre = this.getPrePost(startOffset, commentsOnly)
    return node
  }

  protected startRule() {
    if (!this.RECORDING_PHASE) {
      let { startOffset, startLine, startColumn } = this.LA(1)
      this.locationStack.push([startOffset, startLine!, startColumn!, NaN, NaN, NaN])
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