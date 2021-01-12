import {
  EmbeddedActionsParser,
  TokenType,
  IToken,
  ConsumeMethodOpts,
  SubruleMethodOpts,
  CstElement,
  tokenMatcher,
  EOF
} from 'chevrotain'

export interface ICaptureResult {
  tokens: IToken[]
  elements: CstElement[]
}

export class BaseParserClass extends EmbeddedActionsParser {
  protected CAPTURE_INDEX: number[] = []
  protected currIdx: number

  public PEEK(tokenToFind: IToken): boolean {
    let token: IToken = this.LA(1)
    const tokenType = tokenToFind.tokenType
    let i = 1
    let found = false
    while (token.tokenType !== EOF) {
      if (tokenMatcher(token, tokenType)) {
        found = true
        break
      }
      i++
      token = this.LA(i)
    }
    return found
  }

  /**
   * Find the next token outside of any blocks
   */
  // public PEEK2(searchTokenTypes: TokenType[]): boolean {
  //   let token: IToken = this.LA(1)
  //   let tokenType = token.tokenType
  //   let i = 1
  //   let found = false
  //   let blockStack: TokenType[] = []

  //   const {
  //     Function,
  //     LParen,
  //     RParen,
  //     LSquare,
  //     RSquare,
  //     LCurly,
  //     RCurly,
  //     SemiColon
  //   } = this.T
    
  //   while (tokenType !== EOF) {
  //     if (blockStack.length === 0) {
  //       /** We've searched far enough */
  //       if (
  //         tokenType === SemiColon ||
  //         tokenType === RSquare ||
  //         tokenType === RParen ||
  //         tokenType === RCurly
  //       ) {
  //         break
  //       }
  //       for (let i = 0; i < searchTokenTypes.length; i++) {
  //         if (tokenMatcher(token, searchTokenTypes[i])) {
  //           found = true
  //           break
  //         }
  //       }
  //       if (found) {
  //         break
  //       }
  //     }

  //     switch (tokenType) {
  //       case Function:
  //       case LParen:
  //         blockStack.unshift(RParen)
  //         break
  //       case LSquare:
  //         blockStack.unshift(RSquare)
  //         break
  //       case LCurly:
  //         blockStack.unshift(RCurly)
  //         break
  //       case RParen:
  //       case RSquare:
  //       case RCurly:
  //         if (blockStack[0] === tokenType) {
  //           blockStack.shift()
  //         }
  //     }
      
  //     token = this.LA(++i)
  //     tokenType = token.tokenType
  //   }
  //   return found
  // }

  public CAPTURE(): number {
    let idx = -1
    if (!this.RECORDING_PHASE) {
      /** Capture start index */
      idx = this.currIdx + 1
      this.CAPTURE_INDEX.push(idx)
    }
    return idx
  }

  public END_CAPTURE(): IToken[] {
    let tokens: IToken[] = []
    if (!this.RECORDING_PHASE) {
      const startIndex = this.CAPTURE_INDEX.pop()
      const endIndex = this.currIdx + 1
      tokens = this.input.slice(startIndex, endIndex)
    }
    return tokens
  }
}
