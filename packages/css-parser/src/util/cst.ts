import type { IToken } from 'chevrotain'
import type { AdvancedCstNode } from '../advancedCstParser'

export const stringify = (cst: AdvancedCstNode): string => {
  let output = ''

  const recurseCst = (node: AdvancedCstNode | IToken): void => {
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