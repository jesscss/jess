/**
 * Creates a Jess AST from a Chevrotain CST
 */
import {
  type CstElement,
  type IToken,
  type CstNodeLocation
} from 'chevrotain'
import {
  type Node,
  type LocationInfo,
  TreeContext,
  Root,
  Anonymous,
  Rule,
  Declaration,
  Scope, type SimpleSelector,
  SelectorList,
  SelectorSequence,
  type Ruleset, type Combinator
} from '@jesscss/core'
/** Change to JessCstParser? */
import {
  type CssCstParser,
  type AdvancedCstNode as RequiredCstNode,
  type TokenKey,
  type NodeKey
} from '@jesscss/css-parser'

type AdvancedCstNode = Omit<RequiredCstNode, 'children'> & {
  children: {
    [token: TokenKey]: Array<IToken | undefined> | undefined
    [node: NodeKey]: Array<AdvancedCstNode | undefined> | undefined
  }
}

type CstNode = AdvancedCstNode | AdvancedCstNode[]

type PossibleCstNode = CstNode | undefined

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

const { isArray } = Array

export function getASTFromCST<T extends CssCstParser = CssCstParser>(
  cst: RequiredCstNode,
  cstParserInstance: T,
  // @ts-expect-error - this is exported correctly, not sure what the problem is
  context: TreeContext = new TreeContext()
): Node {
  const BaseVisitor = cstParserInstance.getBaseCstVisitorConstructor<RequiredCstNode, Node>()
  let initialScope = context.scope ??= new Scope()

  class Visitor extends BaseVisitor {
    constructor() {
      super()

      if (process.env.TEST === 'true') {
        // this.validateVisitor()
      }
    }

    /**
     * Override base visit method - otherwise, there's no way to get
     * the location object on the CST node.
     */
    // @ts-expect-error - Overriding the visit type with our own type
    visit<T extends Node = Node>(cstNode: CstNode, param?: any): T {
      // enables writing more concise visitor methods when CstNode has only a single child
      if (isArray(cstNode)) {
        // A CST Node's children dictionary can never have empty arrays as values
        // If a key is defined there will be at least one element in the corresponding value array.
        cstNode = cstNode[0]
      }
      return this[cstNode.name as keyof Visitor](cstNode, param) as T
    }

    tryVisit<T extends Node = Node>(cstNode: PossibleCstNode, param?: any): T | undefined {
    // enables writing more concise visitor methods when CstNode has only a single child
      if (isArray(cstNode)) {
      // A CST Node's children dictionary can never have empty arrays as values
      // If a key is defined there will be at least one element in the corresponding value array.
        cstNode = cstNode[0]
      }
      // enables passing optional CstNodes concisely.
      if (cstNode === undefined) {
        return undefined
      }
      return this[cstNode.name as keyof Visitor](cstNode, param) as T
    }

    stylesheet(ctx: AdvancedCstNode, param?: any): Root {
      const { children: { main, Charset } } = ctx
      let root = this.tryVisit<Root>(main as PossibleCstNode)
      root ??= new Root([], undefined, getLocationInfo(ctx.location), context)
      /** Charset looks like an at-rule but it isn't - it is a single token */
      let charset = Charset?.[0]
      if (isToken(charset)) {
        root.value.unshift(new Anonymous(charset.image, undefined, getLocationInfo(charset), context))
      }
      /** Restore initial scope */
      context.scope = initialScope
      return root
    }

    main(ctx: AdvancedCstNode, param?: any): Root {
      const { childrenStream } = ctx
      let rules = (childrenStream as RequiredCstNode[]).map(child => this.visit(child))
      return new Root(rules, undefined, getLocationInfo(ctx.location), context)
    }

    qualifiedRule(ctx: AdvancedCstNode, param?: any): Rule {
      const {
        children: { selectorList, forgivingSelectorList }
      } = ctx
      let selector = this.visit<SelectorList | SelectorSequence | SimpleSelector>(
        (selectorList ?? forgivingSelectorList) as CstNode
      )
      let declarationList = this.visit<Ruleset>(ctx.children.declarationList as CstNode)

      return new Rule([
        ['selector', selector],
        ['value', declarationList]
      ], undefined, getLocationInfo(ctx.location), context)
    }

    selectorList(ctx: AdvancedCstNode, param?: any): SelectorList | SelectorSequence {
      const {
        children: { complexSelector }
      } = ctx
      let selectors: SelectorSequence[] = (complexSelector as RequiredCstNode[]).map(child => this.visit(child))
      if (selectors.length === 1) {
        return selectors[0]
      }
      return new SelectorList(selectors, undefined, getLocationInfo(ctx.location), context)
    }

    complexSelector(ctx: AdvancedCstNode, param?: any): SelectorSequence {
      const {
        childrenStream
      } = ctx
      let elements: Array<SimpleSelector | Combinator> = []
      for (let child of childrenStream as RequiredCstNode[]) {
        /** We don't use a visit rule for compoundSelector */
        if (child.name === 'compoundSelector') {
          for (let sel of child.childrenStream as RequiredCstNode[]) {
            let element = this.visit<SimpleSelector>(sel)
            if (element) {
              elements.push(element)
            }
          }
        } else {
          let element = this.visit<Combinator>(child)
          if (element) {
            elements.push(element)
          }
        }
      }
      return new SelectorSequence(elements, undefined, getLocationInfo(ctx.location), context)
    }
  }

  const visitor = new Visitor()
  return visitor.visit(cst)
}
