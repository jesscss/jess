/**
 * Creates a Jess AST from a Chevrotain CST
 */
import { type CstNode, type CstParser } from 'chevrotain'
import { type Root, type TreeContext } from '@jesscss/core'

export function getASTFromCST<T extends CstParser = CstParser>(
  cst: CstNode,
  cstParserInstance: T,
  context: TreeContext
): Root {
  const BaseVisitor = cstParserInstance.getBaseCstVisitorConstructor<CstNode, Root>()
  const visitor = new (class extends BaseVisitor {
    constructor() {
      super()

      if (process.env.TEST === 'true') {
        this.validateVisitor()
      }
    }

    stylesheet(ctx: CstNode) {

    }
  })()
  return visitor.visit(cst)
}
