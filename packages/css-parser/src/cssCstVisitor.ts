import {
  type CstNodeLocation
} from 'chevrotain'
import {
  Node,
  type LocationInfo,
  TreeContext,
  Root,
  Anonymous,
  Ruleset,
  Declaration,
  Scope, type SimpleSelector,
  SelectorList,
  SelectorSequence,
  Rules,
  Combinator,
  BasicSelector,
  Ampersand,
  List,
  Sequence,
  Dimension,
  Color,
  Comment,
  Func,
  Call,
  Paren,
  Quoted
} from '@jesscss/core'
import { type CssRules } from './cssParser'

import {
  type AdvancedCstNode as RequiredCstNode,
  type IToken,
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

export function isToken(node: any): node is IToken {
  return Boolean(node && 'tokenType' in node)
}

export function getLocationInfo(loc: Required<CstNodeLocation>): LocationInfo {
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
  preSkippedTokenMap: Map<number, IToken[]>
  postSkippedTokenMap: Map<number, IToken[]>
  usedSkippedTokens: Set<number>
  context: TreeContext
  initialScope: Scope

  /** This is a required call for a functioning visitor */
  init(skippedTokenMap: Map<number, IToken[]>) {
    this.preSkippedTokenMap = skippedTokenMap
    this.postSkippedTokenMap = new Map()
    /**
     * Make a post skipped token map. When we pass in a
     * non-skipped-token's endOffset, it should look up
     * to see if there's a token group that immediately
     * follows.
     */
    for (let [,tokens] of skippedTokenMap) {
      let startOffset = tokens[0]!.startOffset - 1
      this.postSkippedTokenMap.set(startOffset, tokens)
    }
    this.usedSkippedTokens = new Set()
    // @ts-expect-error - this is exported correctly, not sure what the problem is
    let context = this.context = new TreeContext()
    this.initialScope = context.scope = new Scope()
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
      cstNode = cstNode[0]!
    }
    if (!this[cstNode.name]) {
      throw new Error(`No visitor method defined for ${cstNode.name}`)
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
    if (!this[cstNode.name]) {
      throw new Error(`No visitor method defined for ${cstNode.name}`)
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

  private _getPrePost(offset: number, commentsOnly?: boolean, post?: boolean): Node['pre'] {
    if (!post && this.usedSkippedTokens.has(offset)) {
      return 0
    }
    let skipped = post ? this.postSkippedTokenMap.get(offset) : this.preSkippedTokenMap.get(offset)
    if (!skipped) {
      return 0
    }
    if (!post) {
      this.usedSkippedTokens.add(offset)
    }
    let pre: Node['pre'] = skipped.map(token => {
      let name = token.tokenType.name
      if (name === 'WS') {
        return token.image
      } else {
        return new Comment(token.image, { lineComment: name.includes('Line') }, getLocationInfo(token), this.context)
      }
    })
    if (commentsOnly) {
      pre = pre.filter(item => item instanceof Comment)
    }

    if (pre.length === 1 && pre[0] === ' ') {
      pre = 1
    }
    return pre
  }

  private _getRulesWithComments(nodes: AdvancedCstNode[]) {
    let rules = []
    /**
     * @todo - I think this pattern means that comments after
     * the last rule will be tossed out, so we need to figure
     * out a way to get comments when comments are the only
     * content in a file.
     */
    let rule: Node | undefined
    for (let child of nodes) {
      /** Skip extraneous semi-colons */
      if (isToken(child)) {
        continue
      }
      let pre = this._getPrePost(child.location.startOffset, true)
      if (isArray(pre)) {
        let i = 0
        let item = pre[i]
        while (item) {
          if (item instanceof Node) {
            let prev = pre[i - 1]
            /** Attach whitespace before comment to comment */
            if (prev) {
              item.pre = [prev]
              pre.shift()
              i--
            }
            rules.push(item)
            pre.shift()
            i--
          }
          item = pre[++i]
        }
      }
      rule = this.visit(child)
      rule.pre = pre
      rules.push(rule)
    }
    return rules
  }

  private _wrap<T extends Node = Node>(node: T, post?: boolean | 'both', commentsOnly?: boolean): T {
    if (post) {
      let endOffset = node.location[3]!
      node.post = this._getPrePost(endOffset, commentsOnly, true)
      if (post !== 'both') {
        return node
      }
    }
    let startOffset = node.location[0]!
    node.pre = this._getPrePost(startOffset, commentsOnly)
    return node
  }

  main(ctx: AdvancedCstNode, param?: any): Root {
    const { childrenStream } = ctx
    let rules = this._getRulesWithComments(childrenStream as RequiredCstNode[])
    return new Root(rules, undefined, getLocationInfo(ctx.location), this.context)
  }

  qualifiedRule(ctx: AdvancedCstNode, param?: any): Ruleset {
    const {
      children: { selectorList, forgivingSelectorList }
    } = ctx
    let selector = this.visit<SelectorList | SelectorSequence | SimpleSelector>(
      (selectorList ?? forgivingSelectorList) as CstNode
    )
    let declarationList = this.visit<Rules>(ctx.children.declarationList as CstNode)

    /** These will already have pre-nodes assigned by `main` / `declarationList` */
    return new Ruleset([
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
      return selectors[0]!
    }
    return new SelectorList(selectors, undefined, getLocationInfo(ctx.location), this.context)
  }

  forgivingSelectorList(ctx: AdvancedCstNode, param?: any): SelectorList | SelectorSequence {
    const {
      children: { relativeSelector }
    } = ctx
    let selectors: SelectorSequence[] = (relativeSelector as RequiredCstNode[]).map(child => this.visit(child))
    if (selectors.length === 1) {
      return selectors[0]!
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

  private _processSelectorToken(token: IToken) {
    switch (token.tokenType.name) {
      case 'Ident':
      case 'Star':
        return new BasicSelector(token.image, undefined, getLocationInfo(token), this.context)
      case 'Ampersand':
        return new Ampersand('&', undefined, getLocationInfo(token), this.context)
    }
  }

  simpleSelector(ctx: AdvancedCstNode, param?: any): SimpleSelector {
    const {
      children: {
        Selector,
        selector
      }
    } = ctx
    let token = Selector ? this._processSelectorToken(Selector[0]!) : undefined
    if (token) {
      return this._wrap(token, true, true)
    }
    return this._wrap(
      this.visit<SimpleSelector>(selector as RequiredCstNode[]),
      true,
      true
    )
  }

  classSelector(ctx: AdvancedCstNode, param?: any): BasicSelector {
    return new BasicSelector(ctx.children.DotName![0]!.image, undefined, getLocationInfo(ctx.location), this.context)
  }

  idSelector(ctx: AdvancedCstNode, param?: any): BasicSelector {
    let { children: { HashName, ColorIdentStart } } = ctx
    let id = (HashName?.[0] ?? ColorIdentStart?.[0])!
    return new BasicSelector(id.image, undefined, getLocationInfo(ctx.location), this.context)
  }

  attributeSelector(ctx: AdvancedCstNode, param?: any): BasicSelector {
    let {
      children: {
        Key

      }
    } = ctx

    let id = (HashName?.[0] ?? ColorIdentStart?.[0])!
    return new BasicSelector(id.image, undefined, getLocationInfo(ctx.location), this.context)
  }

  declarationList(ctx: AdvancedCstNode, param?: any): Rules {
    const { childrenStream } = ctx
    let context = this.context
    let initialScope = context.scope
    context.scope = new Scope(initialScope)
    let rules = this._getRulesWithComments(childrenStream as RequiredCstNode[])
    let ruleset = new Rules(rules, undefined, getLocationInfo(ctx.location), this.context)
    context.scope = initialScope
    return ruleset
  }

  declaration(ctx: AdvancedCstNode, param?: any): Declaration {
    const {
      children: {
        Name,
        valueList,
        Important
      }
    } = ctx

    /** Had to have a property when parsed */
    let name = Name![0]!.image
    let value = this.visit(valueList as RequiredCstNode[])
    /** Insert initial whitespace before value, if not present */
    if (!this.preSkippedTokenMap.has(value.location[0]!)) {
      value.pre = 1
    }
    let important = Important?.[0] ? Important?.[0].image : undefined

    return new Declaration([
      ['name', name],
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
    let node: Node
    if (values.length === 1) {
      node = values[0]!
    } else {
      node = new List(values, { slash }, getLocationInfo(ctx.location), this.context)
    }
    return this._wrap(node)
  }

  valueSequence(ctx: AdvancedCstNode, param?: any) {
    const {
      children: { value }
    } = ctx
    let values = (value as RequiredCstNode[]).map(child => this.visit(child))
    if (values.length === 1) {
      return values[0]!
    }
    return new Sequence(values, undefined, getLocationInfo(ctx.location), this.context)
  }

  private _processValueToken(
    children: AdvancedCstNode['children'],
    tok: 'Ident' | 'Dimension' | 'Number' | 'Color' | 'LegacyMSFilter' | 'MathConstant'
  ) {
    let token = children[tok]?.[0]
    if (isToken(token)) {
      let tokValue = token.image
      let dimValue: [number: number, unit?: string] | undefined
      const getDimension = (finalValue: Exclude<typeof dimValue, undefined>) =>
        new Dimension(finalValue, undefined, getLocationInfo(token!), this.context)
      switch (tok) {
        case 'Ident':
          /** @todo - check to see if it's a color */
        // eslint-disable-next-line no-fallthrough
        case 'LegacyMSFilter':
          return new Anonymous(tokValue, undefined, getLocationInfo(token), this.context)
        case 'Dimension':
          dimValue = [parseFloat(token.payload[1]), token.payload[2]]
          return getDimension(dimValue)
        case 'MathConstant':
          switch (tokValue.toLowerCase()) {
            case 'pi':
              dimValue = [Math.PI]
              break
            case 'infinity':
              dimValue = [Infinity]
              break
            case '-infinity':
              dimValue = [-Infinity]
              break
            case 'e':
              dimValue = [Math.E]
              break
            case 'nan':
              dimValue = [NaN]
          }
          return getDimension(dimValue!)
        case 'Number':
          dimValue ??= [parseFloat(tokValue)]
          return getDimension(dimValue)
        case 'Color':
          return new Color(tokValue, undefined, getLocationInfo(token), this.context)
      }
    }
  }

  value(ctx: AdvancedCstNode, param?: any) {
    const {
      children
    } = ctx

    let processToken = this._processValueToken.bind(this, children)
    let token = processToken('Ident') ??
      processToken('Dimension') ??
      processToken('Number') ??
      processToken('Color') ??
      processToken('LegacyMSFilter')

    if (token) {
      return this._wrap(token)
    }

    const { function: func, string, squareValue } = children

    return this._wrap(
      this.visit<Node>(
        (func ?? string ?? squareValue) as RequiredCstNode[]
      )
    )
  }

  function(ctx: AdvancedCstNode, param?: any) {
    const {
      children: {
        knownFunctions,
        Ident,
        valueList
      }
    } = ctx
    if (knownFunctions) {
      return this.visit(knownFunctions as RequiredCstNode[])
    }
    let funcValue: ConstructorParameters<typeof Func>[0] = [['name', Ident?.[0]?.image]]
    if (valueList) {
      funcValue.push(['args', this.visit(valueList as RequiredCstNode[])])
    }
    return new Func(funcValue, undefined, getLocationInfo(ctx.location), this.context)
  }

  knownFunctions(ctx: AdvancedCstNode, param?: any) {
    const {
      children: {
        urlFunction,
        varFunction,
        calcFunction
      }
    } = ctx
    return this.visit((urlFunction ?? varFunction ?? calcFunction) as RequiredCstNode[])
  }

  urlFunction(ctx: AdvancedCstNode, param?: any) {
    const {
      children: {
        string,
        NonQuotedUrl
      }
    } = ctx

    let value: Node | undefined
    if (string) {
      value = this._wrap(this.visit(string as RequiredCstNode[]), 'both')
    } else {
      value = new Anonymous(NonQuotedUrl![0]!.image, undefined, getLocationInfo(ctx.location), this.context)
    }

    return new Call([
      ['name', 'url'],
      ['value', value]
    ], undefined, getLocationInfo(ctx.location), this.context)
  }

  calcFunction(ctx: AdvancedCstNode, param?: any) {
    const {
      children: {
        mathSum
      }
    } = ctx
    let value = this.visit(mathSum as RequiredCstNode[])
    return new Call([
      ['name', 'calc'],
      ['value', value]
    ], undefined, getLocationInfo(ctx.location), this.context)
  }

  mathSum(ctx: AdvancedCstNode, param?: any) {
    const { childrenStream } = ctx
    let values: Node[] = []
    let wrap = this._wrap.bind(this)
    const addNodes = (stream: Array<RequiredCstNode | IToken>) => {
      for (let child of stream) {
        if (isToken(child)) {
          values.push(wrap(new Anonymous(child.image, undefined, getLocationInfo(child), this.context)))
        } else if (child.name === 'mathProduct') {
          addNodes(child.childrenStream)
        } else {
          values.push(wrap(this.visit(child)))
        }
      }
    }
    addNodes(childrenStream)
    return wrap(new Sequence(values, undefined, getLocationInfo(ctx.location), this.context), true)
  }

  mathValue(ctx: AdvancedCstNode, param?: any) {
    const {
      children
    } = ctx

    let processToken = this._processValueToken.bind(this, children)
    let token = processToken('Number') ??
      processToken('Dimension') ??
      processToken('MathConstant')

    if (token) {
      return token
    }

    const { knownFunctions, mathSum } = children

    let value: Node | undefined
    if (mathSum) {
      value = this.visit(mathSum as RequiredCstNode[])
      return new Paren(value, undefined, getLocationInfo(ctx.location), this.context)
    }

    return this.visit<Node>(knownFunctions as RequiredCstNode[])
  }

  string(ctx: AdvancedCstNode, param?: any) {
    const {
      children: {
        contents,
        Quote
      }
    } = ctx

    let contentsItem: AdvancedCstNode | IToken = contents![0]!
    let contentsNode: Node | undefined

    if (isToken(contentsItem)) {
      contentsNode = new Anonymous(contentsItem.image, undefined, getLocationInfo(contentsItem), this.context)
    } else {
      contentsNode = this.visit(contentsItem)
    }

    return new Quoted(contentsNode, { quote: Quote![0]!.image as "'" | '"' }, getLocationInfo(ctx.location), this.context)
  }
}