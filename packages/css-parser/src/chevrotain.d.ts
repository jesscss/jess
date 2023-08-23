/* eslint-disable @typescript-eslint/ban-ts-comment, @typescript-eslint/prefer-ts-expect-error */
import type {
  TokenType,
  IToken,
  CstElement,
  ConsumeMethodOpts,
  CstChildrenDictionary,
  CstNodeLocation
} from 'chevrotain'

declare module 'chevrotain' {
  interface CstParser {
    consumeInternal(tokType: TokenType, idx: number, options?: ConsumeMethodOpts): IToken
    cstPostTerminal(key: string, consumedToken: IToken): void
    setInitialNodeLocation(node: CstNode): void
    setNodeLocationFromToken: (
      nodeLocation: CstNodeLocation,
      locationInformation: CstNodeLocation,
    ) => void
    setNodeLocationFromNode: (
      nodeLocation: CstNodeLocation,
      locationInformation: CstNodeLocation,
    ) => void
    // @ts-ignore - this is defined as a property in Chevrotain
    set input(value: IToken[])
    // @ts-ignore - this is defined as a property in Chevrotain
    get input(): IToken[]
    currIdx: number
    CST_STACK: CstNode[]
  }

  interface CstNode {
    readonly name: string
    readonly children: CstChildrenDictionary
    readonly recoveredNode?: boolean
    readonly location?: CstNodeLocation
    /** Extension */
    childrenStream: CstElement[]
  }
}