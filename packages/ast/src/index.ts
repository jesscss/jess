/**
 * Creates a Jess AST from a Chevrotain CST
 */
import {
  type CstElement,
  type IToken,
  type CstNodeLocation,
  type CstNode
} from 'chevrotain'
import {
  type Node,
  type LocationInfo,
  TreeContext,
  Root,
  Anonymous,
  Scope
} from '@jesscss/core'
/** Change to JessCstParser? */
import { type CssCstParser, type AdvancedCstNode as RequiredCstNode } from '@jesscss/css-parser'

type AdvancedCstNode = Omit<RequiredCstNode, 'children'> & {
  children: Record<string, Array<CstElement | undefined> | undefined>
}

export function isToken(node: CstElement | undefined): node is IToken {
  return Boolean(node && 'tokenType' in node)
}

export function getLocationInfo(loc: CstNodeLocation): LocationInfo {
  const {
    startOffset,
    startLine,
    startColumn,
    endOffset,
    endLine,
    endColumn
  } = loc
  return [startOffset, startLine, startColumn, endOffset, endLine, endColumn]
}

export function getASTFromCST<T extends CssCstParser = CssCstParser>(
  cst: RequiredCstNode,
  cstParserInstance: T,
  // @ts-expect-error - this is exported correctly, not sure what the problem is
  context: TreeContext = new TreeContext()
): Node {
  const BaseVisitor = cstParserInstance.getBaseCstVisitorConstructor<RequiredCstNode, Node>()
  let initialScope = context.scope ??= new Scope()
  const visitor = new (class extends BaseVisitor {
    constructor() {
      super()

      if (process.env.TEST === 'true') {
        this.validateVisitor()
      }
    }

    stylesheet(ctx: AdvancedCstNode) {
      const { children } = ctx
      let root = children.main
        ? this.visit(children.main as CstNode[])
        : new Root([], undefined, getLocationInfo(ctx.location), context)
      /** Charset looks like an at-rule but it isn't - it is a single token */
      let charset = children.Charset?.[0]
      if (isToken(charset)) {
        root.value.unshift(new Anonymous(charset.image, undefined, getLocationInfo(charset)))
      }
      /** Restore initial scope */
      context.scope = initialScope
      return root
    }
  })()
  return visitor.visit(cst)
}
