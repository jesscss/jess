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
    set input(value: IToken[])
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