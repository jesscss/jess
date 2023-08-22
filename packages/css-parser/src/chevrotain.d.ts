import type { TokenType, IToken, ConsumeMethodOpts } from 'chevrotain'

declare module 'chevrotain' {
  interface CstParser {
    consumeInternal(tokType: TokenType, idx: number, options?: ConsumeMethodOpts): IToken
    consumeToken(): void
    cstPostTerminal(key: string, consumedToken: IToken): void
  }
}