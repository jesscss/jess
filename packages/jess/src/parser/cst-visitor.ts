import { CstChild, CstNode, IToken } from '@jesscss/css-parser'
import { isToken, getLocation, collectTokens, collapseTokens, flatten } from './util'
import { tokenMatcher } from 'chevrotain'
import type { JessParser } from '@jess/parser'
import {
  Anonymous,
  Call,
  Node,
  Root,
  Rule,
  List,
  Element,
  Ruleset,
  Declaration,
  Expression,
  Let,
  JsKeyValue,
  WS,
  Dimension,
  LocationInfo,
  Selector,
  Combinator,
  AtRule,
  JsCollection
} from '../tree'
import { JsImport } from '../tree/js-import'

export type BaseTokenType = Pick<
  IToken,
  'image' | 'startLine' | 'startColumn' | 'startOffset' |
  'endLine' | 'endColumn' | 'endOffset'
>

export class CstVisitor {
  [k: string]: any
  parser: JessParser

  constructor(parser: JessParser) {
    this.parser = parser
  }

  visit(ctx: CstNode | BaseTokenType, Clazz?: any): any {
    if (!ctx) {
      return
    }
    if (isToken(ctx)) {
      const tokens = this.parser.T
      const {
        image,
        startLine,
        startColumn,
        startOffset,
        endLine,
        endColumn,
        endOffset
      } = ctx

      const loc: LocationInfo = [
        startLine,
        startColumn,
        startOffset,
        endLine,
        endColumn,
        endOffset
      ]

      if (tokenMatcher(ctx, tokens.Dimension) || tokenMatcher(ctx, tokens.Number)) {
        return new Dimension(image, loc)
      }

      /** @todo - make more Node types eventually? */
      if (!Clazz) {
        if (tokenMatcher(ctx, tokens.WS)) {
          Clazz = WS
        } else {
          Clazz = Anonymous
        }
      }

      return new Clazz(image, loc)
    }
    const visit = this[(<CstNode>ctx).name]
    if (!visit) {
      throw { message: `CST '${(<CstNode>ctx).name}' is not valid.` }
    }
    return visit.call(this, ctx)
  }

  visitArray(coll: CstChild[]): any[] {
    return coll.map(node => this.visit(node)).filter(node => node)
  }

  /** Start building AST */
  root({ children, location }: CstNode) {
    const nodes = this.visitArray(children)
    return new Root(nodes, getLocation(location))
  }

  rule({ children, location }: CstNode): Node {
    let [pre, rule] = children
    const ws = this.visit(pre)
    const node = this.visit(rule)
    return node
  }

  atRule({ children, location }: CstNode) {
    const name: string = (<IToken>children[0]).image
    const prelude = (<CstNode>children[1])
    const value: Node = this.visit(prelude)
    if ((<CstNode>prelude.children[1])?.name === 'atImportJs') {
      return new JsImport(value.value)
    }
    let rulesChild = children[2]
    let rules: Node
    if ('image' in rulesChild) {
      rules = undefined
    } else {
      rules = this.visit(rulesChild)
    }
    return new AtRule({ name, value, rules }, getLocation(location))
  }

  atLet({ children, location }: CstNode) {
    return new Let(this.visit(children[2]), getLocation(location))
  }

  atLetValue({ children }: CstNode) {
    return new JsKeyValue({
      name: (<IToken>(<CstNode>children[0]).children[0]).image,
      value: this.visit((<CstNode>children[1]).children[0])
    })
  }

  jsCollection({ children }: CstNode) {
    const nodes = this.visitArray((<CstNode>children[2]).children)
    return new JsCollection(nodes)
  }

  jsCollectionNode({ children }: CstNode) {
    return this.visit(children[0])
  }


  prelude({ children }: CstNode) {
    /**
     * For now, just collapse the prelude to a single anonymous node
     */
    const tokens: IToken[] = []
    collectTokens(children, tokens)
    return this.visit(collapseTokens(tokens))
  }

  customPrelude({ children }: CstNode) {
    const tokens: IToken[] = []
    collectTokens(children, tokens)
    return this.visit(collapseTokens(tokens))
  }

  customValue({ children }: CstNode) {
    const value = collapseTokens(collectTokens(children))
    return new Anonymous(value.image)
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
    return new List(list, getLocation(location))
  }

  complexSelector({ children, location }: CstNode) {
    const [initial, ...combinators] = children
    const compound = this.visit(initial)
    const combinator = flatten(this.visitArray(combinators))

    return new Selector([...compound, ...combinator], getLocation(location))
  }

  compoundSelector({ children }: CstNode) {
    return children.map(child => this.visit(child, Element))
  }

  combinatorSelector({ children }: CstNode) {
    /** Discard trailing WS */
    if (children.length === 1) {
      return []
    }
    return [
      this.visit((<CstNode>children[0]).children[1], Combinator),
      ...this.visit(children[1])
    ]
  }

  pseudoSelector({ children }: CstNode) {    
    const selector = collapseTokens(collectTokens(children))
    return new Element(selector.image)
  }

  attrSelector({ children }: CstNode) {
    const selector = collapseTokens(collectTokens(children))
    return new Element(selector.image)
  }

  curlyBlock({ children, location}: CstNode) {
    const rules = this.visit(children[1])
    return new Ruleset(rules, getLocation(location))
  }

  rules({ children, location }: CstNode) {
    return this.visitArray(children)
  }

  declaration({ children, location }: CstNode) {
    const name = this.visit(children[0])
    const value = this.visit(children[4])
    const important = children[5] && this.visit((<CstNode>children[5]).children[0])

    return new Declaration({ name, value, important }, getLocation(location))
  }

  /**
   * A property can contain interpolated statements,
   * so it's an expression
   */
  property({ children, location }: CstNode) {
    const name = this.visitArray(children)
    return new Expression(name, getLocation(location))
  }

  function({ children, location }: CstNode) {
    const name = (<IToken>children[0]).image.slice(0, -1)
    const value = this.visit(children[1])
    return new Call({ name, value }, getLocation(location))
  }

  block({ children, location }: CstNode) {
    return new Expression(this.visitArray(children), getLocation(location))
  }

  expression({ children, location }: CstNode) {
    const value = this.visitArray(children)
    if (value[0] instanceof WS) {
      value.shift()
    }
    if (value[value.length - 1] instanceof WS) {
      value.pop()
    }
    if (value.length === 1) {
      return value[0]
    }
    return new Expression(value, getLocation(location))
  }

  expressionList({ children, location }: CstNode) {
    const list = children.filter((val, i) => {
      return i % 2 === 0
    }).map(node => this.visit(node))

    if (list.length === 1) {
      return list[0]
    }
    return new List(list, getLocation(location))
  }
}