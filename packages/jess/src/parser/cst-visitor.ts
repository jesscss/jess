import { CstChild, CstNode, IToken } from '@jesscss/css-parser'
import { isToken, getLocation } from './util'
import {
  Anonymous,
  Node,
  Root,
  Rule
} from '../tree'

export class CstVisitor {
  [k: string]: any

  visit(ctx: CstChild): any {
    if (!ctx) {
      return
    }
    if (isToken(ctx)) {
      const {
        image,
        startLine,
        startColumn,
        startOffset,
        endLine,
        endColumn,
        endOffset
      } = ctx
      return new Anonymous(
        image,
        [
          startLine,
          startColumn,
          startOffset,
          endLine,
          endColumn,
          endOffset
        ]
      )
    }
    const visit = this[ctx.name]
    return visit ? visit.call(this, ctx) : {}
  }

  visitArray(coll: CstChild[]) {
    return coll.map(node => this.visit(node))
  }

  /** Start building AST */
  root({ children, location }: CstNode) {
    const nodes = this.visitArray(children)
    return new Root(nodes, getLocation(location))
  }

  rule({ children, location }: CstNode): Node {
    let [pre, rule] = children
    // const ws = processWS(<IToken>pre)
    const ws = this.visit(pre)
    const node = this.visit(rule)
    return node
  }

  qualifiedRule({ children, location }: CstNode) {
    const [ selectorList, curlyBlock ] = children
    const sels = this.visit(selectorList)
    const value = this.visit(curlyBlock)
    return new Rule({ sels, value }, getLocation(location))
  }

  selectorList({ children, location}: CstNode) {
    const list = children.filter((val, i) => {
      return i % 2 === 0
    }).map(node => this.visit(node))
    return {}
  }

  complexSelector({ children, location }: CstNode) {
    const [ selectors, extend ] = children
    return {}
  }

  compoundSelector({ children, location }: any) {
    return children
  }
}

export default new CstVisitor()