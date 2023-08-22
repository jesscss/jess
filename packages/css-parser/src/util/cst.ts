import type { CstNode, IToken } from 'chevrotain'

export const stringify = (cst: CstNode): string => {
  let output = ''

  const recurseCst = (node: CstNode | IToken): void => {
    if (!node) {
      return
    }
    if ('name' in node) {
      node.childrenStream.forEach(child => { recurseCst(child) })
      return
    }
    output += node.image
  }
  recurseCst(cst)

  return output
}