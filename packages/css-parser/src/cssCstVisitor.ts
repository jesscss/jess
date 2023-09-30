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
  Rule, Declaration,
  Scope, type SimpleSelector,
  SelectorList,
  SelectorSequence,
  Ruleset,
  Combinator,
  BasicSelector,
  Ampersand,
  List
} from '@jesscss/core'
import { type CssRules } from './cssParser'

import {
  type AdvancedCstNode as RequiredCstNode,
  type TokenKey,
  type NodeKey
} from './advancedCstParser'

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

type VisitorMethodNames = Exclude<CssRules, 'compoundSelector'>

type CssRuleMethods = {
  [rule in VisitorMethodNames]: (ctx: AdvancedCstNode, param?: any) => Node
}

export class CssCstVisitor implements CssRuleMethods {
  context: TreeContext
  initialScope: Scope

  constructor(context?: TreeContext) {
    // @ts-expect-error - this is exported correctly, not sure what the problem is
    context ??= new TreeContext()
    this.context = context
    this.initialScope = context.scope ??= new Scope()
  }

  /**
   * Override base visit method - otherwise, there's no way to get
   * the location object on the CST node.
   */
  visit<T extends Node = Node>(cstNode: CstNode, param?: any): T {
    // enables writing more concise visitor methods when CstNode has only a single child
    if (isArray(cstNode)) {
      // A CST Node's children dictionary can never have empty arrays as values
      // If a key is defined there will be at least one element in the corresponding value array.
      cstNode = cstNode[0]
    }
    return this[cstNode.name as VisitorMethodNames](cstNode, param) as T
  }

  protected tryVisit<T extends Node = Node>(cstNode: PossibleCstNode, param?: any): T | undefined {
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
    return this[cstNode.name as VisitorMethodNames](cstNode, param) as T
  }

  stylesheet(ctx: AdvancedCstNode, param?: any): Root {
    const { children: { main, Charset } } = ctx
    let root = this.tryVisit<Root>(main as PossibleCstNode)
    root ??= new Root([], undefined, getLocationInfo(ctx.location), this.context)
    /** Charset looks like an at-rule but it isn't - it is a single token */
    let charset = Charset?.[0]
    if (isToken(charset)) {
      root.value.unshift(new Anonymous(charset.image, undefined, getLocationInfo(charset), this.context))
    }
    /** Restore initial scope */
    this.context.scope = this.initialScope
    return root
  }

  main(ctx: AdvancedCstNode, param?: any): Root {
    const { childrenStream } = ctx
    let rules = (childrenStream as RequiredCstNode[]).map(child => this.visit(child))
    return new Root(rules, undefined, getLocationInfo(ctx.location), this.context)
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
    ], undefined, getLocationInfo(ctx.location), this.context)
  }

  selectorList(ctx: AdvancedCstNode, param?: any): SelectorList | SelectorSequence {
    const {
      children: { complexSelector }
    } = ctx
    let selectors: SelectorSequence[] = (complexSelector as RequiredCstNode[]).map(child => this.visit(child))
    if (selectors.length === 1) {
      return selectors[0]
    }
    return new SelectorList(selectors, undefined, getLocationInfo(ctx.location), this.context)
  }

  forgivingSelectorList(ctx: AdvancedCstNode, param?: any): SelectorList | SelectorSequence {
    const {
      children: { relativeSelector }
    } = ctx
    let selectors: SelectorSequence[] = (relativeSelector as RequiredCstNode[]).map(child => this.visit(child))
    if (selectors.length === 1) {
      return selectors[0]
    }
    return new SelectorList(selectors, undefined, getLocationInfo(ctx.location), this.context)
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
    return new SelectorSequence(elements, undefined, getLocationInfo(ctx.location), this.context)
  }

  relativeSelector(ctx: AdvancedCstNode, param?: any): SelectorSequence {
    return this.complexSelector(ctx)
  }

  combinator(ctx: AdvancedCstNode, param?: any): Combinator {
    const { children: { Combinator: combinator } } = ctx
    let co = combinator?.[0]
    if (isToken(co)) {
      return new Combinator(co.image, undefined, getLocationInfo(ctx.location), this.context)
    }
    return new Combinator(' ', undefined, getLocationInfo(ctx.location), this.context)
  }

  simpleSelector(ctx: AdvancedCstNode, param?: any): SimpleSelector {
    const {
      children
    } = ctx
    let processToken = (tok: 'Ident' | 'Ampersand' | 'Star') => {
      let token = children[tok]?.[0]
      if (isToken(token)) {
        switch (tok) {
          case 'Ident':
          case 'Star':
            return new BasicSelector(token.image, undefined, getLocationInfo(token), this.context)
          case 'Ampersand':
            return new Ampersand('&', undefined, getLocationInfo(token), this.context)
        }
      }
    }
    let token = processToken('Ident') ?? processToken('Ampersand') ?? processToken('Star')
    if (token) {
      return token
    }
    const { idSelector, classSelector, attributeSelector, pseudoSelector } = children
    return this.visit<SimpleSelector>(
      (idSelector ?? classSelector ?? attributeSelector ?? pseudoSelector) as RequiredCstNode[]
    )
  }

  declarationList(ctx: AdvancedCstNode, param?: any): Ruleset {
    const { childrenStream } = ctx
    let context = this.context
    let initialScope = context.scope
    context.scope = new Scope(initialScope)
    let rules: Node[] = (childrenStream as RequiredCstNode[]).map(child => this.visit<Node>(child))
    let ruleset = new Ruleset(rules, undefined, getLocationInfo(ctx.location), this.context)
    context.scope = initialScope
    return ruleset
  }

  declaration(ctx: AdvancedCstNode, param?: any): Declaration {
    const {
      children: {
        Ident,
        LegacyPropIdent,
        valueList,
        Important
      }
    } = ctx

    /** Had to have a property when parsed */
    let name = (Ident?.[0] ?? LegacyPropIdent?.[0])!
    let value = this.visit(valueList as RequiredCstNode[])
    let important = Important?.[0] ? Important?.[0].image : undefined

    return new Declaration([
      ['name', name.image],
      ['value', value],
      ['important', important]
    ], {}, getLocationInfo(ctx.location), this.context)
  }

  valueList(ctx: AdvancedCstNode, param?: any): Node {
    const { childrenStream } = ctx
    let slash = false
    let values: Node[] = []
    for (let child of childrenStream as RequiredCstNode[]) {
      if (isToken(child)) {
        if (child.image === '/') {
          slash = true
        }
        continue
      }
      values.push(this.visit(child))
    }
    if (values.length === 1) {
      return values[0]
    }
    return new List(values, { slash }, getLocationInfo(ctx.location), this.context)
  }
}