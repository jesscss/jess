import { logger } from '../logger'
import { Declaration } from '../tree/declaration'
import { AssignmentType } from '../tree/base-declaration'
import { List } from '../tree/list'
import { Spaced } from '../tree/spaced'
import type { Node } from '../tree/node'
import type { Mixin } from '../tree/mixin'
import isPlainObject from 'lodash-es/isPlainObject'
import { isNode } from '../tree/util'
import { cast } from '../tree/util/cast'
import { Rules } from '../tree/rules'
import type { Bool } from '../tree/bool'
import type { Condition } from '../tree/condition'
import { Context } from '../context'
import type { General } from '../tree/general'
import type * as tree from '../tree'
import { SinglyLinkedList, Stack } from 'data-structure-typed'

/**
 * The Scope object is meant to be an efficient
 * lookup mechanism for variables, mixins,
 * and other identifiers (including selectors).
 *
 * It leverages the prototype chain for quick scope
 * lookup, and provides a language-agnostic interface
 * for determing behavior when setting identifiers.
 */
export type ScopeEntryOptions = {
  /**
   * These are from JS import statements
   */
  protected?: boolean
  /**
   * Imports from JS/TS are already normalized
   */
  isNormalized?: boolean

  setDefined?: boolean
  setIfUndefined?: boolean
  throwIfDefined?: boolean

  /**
   * Preserve previous entries. Used by Jess/Less for mixins.
   */
  preserve?: boolean

  /**
   * A variable marked private.
   * In SCSS, this is any variable starting with a dash.
   */
  private?: boolean
}

/**
 * For JS interoperability,
 * we cannot allow these identifiers
 */
const RESERVED = [
  'enum',
  'implements',
  'interface',
  'let',
  'package',
  'private',
  'protected',
  'public',
  'static'
]

type FilterResult = {
  value: unknown
  done: boolean
}

export type GetterOptions = {
  /** Filter is a function or value to compare when looking up values */
  filter?: Node | ((value: any, foundValues?: any[]) => FilterResult)

  /** Only return local values, not all scope values */
  local?: boolean
  /**
   * Right now used by Less for functions
   */
  suppressUndefinedError?: boolean
}

class RuleEdge<T extends Node = Node, U extends Stack<Node> = Stack<Node>> {
  /** value */
  0: T
  /** Bridge value (the parent Node stack) */
  1: U | undefined
  /** Bridge key */
  2: string | number | undefined

  constructor(
    value: T,
    bridgeValue?: U,
    bridgeKey: string | number = ''
  ) {
    this[0] = value
    this[1] = bridgeValue
    this[2] = bridgeKey
  }
}

/** @todo - put this into Node */
class Selector {
  inEdge: RuleEdge | undefined
  outEdges: RuleEdge[] | undefined
  constructor(
    public value: Node,
    public key = value.valueOf()
  ) {}
}

class Rule {
  next: Rule | undefined
  previous: Rule | undefined
  constructor(
    public value: Node
  ) {}
}

/**
 * An indexed set of rules which can do fast lookups and merges
 */
export class Rules {
  selectorIndex = new Map<string, Selector>()
  first: Rule | undefined
  last: Rule | undefined

  // add<T extends Node = Node>(n: T) {
  //   if ()

  // }

  addSelectorRule(sel: tree.Selector | tree.SelectorList) {
    if (isNode(sel, 'BasicSelector')) {
      let key = sel.valueOf()
      let rule = new Selector(sel, key)
      this.selectorIndex.set(key, rule)
    }
  }
}

class SelectorTreeNode {
  andEdge: RuleEdge | RuleEdge[] | undefined
  orEdge: RuleEdge | RuleEdge[] | undefined

  constructor(
    public selector: tree.Selector | tree.Combinator | undefined,
    public key: string = selector?.valueOf() ?? ''
  ) {}
}

type NodeStack = Stack<tree.Selector | tree.SelectorList | tree.Combinator>

function getNodeStack(n: tree.Selector | tree.SelectorList | tree.Combinator, nodeStack?: NodeStack): NodeStack {
  nodeStack = nodeStack ? nodeStack.clone() : new Stack()
  nodeStack.push(n)
  return nodeStack
}

// Wait what if the set is like... the repeat of ordered selectors?
/**
 * .a.b.c > .d {}
 * new Set(['0.a', '0.b', '0.c', '0>', '0.d'])
 *
 * and a map of paths to the selector
 *
 * new Map([
 *  ['.a', Scope {
 *    mixinPaths: [Scope '.d'],
 *    exact: [Scope '>', Scope '.d']
 *  }],
 * ])
 */

/** Linked tree representing a selector for easier replacement */
class SelectorTree {
  current: SelectorTreeNode | undefined = undefined
  combinator: tree.Combinator | undefined = undefined
  selectorMap = new Map<string, SinglyLinkedList<SelectorTreeNode>>()

  constructor(sel: tree.Selector | tree.SelectorList) {
    this.add(sel)
  }

  add(n: tree.Selector | tree.Combinator | tree.SelectorList, nodeStack?: NodeStack) {
    if (isNode(n, 'SelectorList')) {
      return this.addSelectorList(n, getNodeStack(n, nodeStack))
    } else if (isNode(n, 'Combinator')) {
      this.combinator = n
    } else if (isNode(n, 'ComplexSelector')) {
      this.addComplexSelector(n, getNodeStack(n, nodeStack))
    } else if (isNode(n, 'CompoundSelector')) {
      this.addCompoundSelector(n, getNodeStack(n, nodeStack))
    } else if (isNode(n, 'PseudoSelector') && (n.arg instanceof Selector || isNode(n.arg, 'SelectorList'))) {
      this.addPseudoSelector(n, getNodeStack(n, nodeStack))
    } else if (isNode(n, 'SimpleSelector')) {
      this.addSimple(n, nodeStack)
    }
  }

  addSimple(n: tree.SimpleSelector, nodeStack: NodeStack | undefined) {
    const key = n.valueOf()
    const node = new SelectorTreeNode(n, key)
    const map = this.selectorMap.get(key) ?? new SinglyLinkedList()
    map.push(node)
    const { current, combinator } = this
    if (current) {
      let edgeKey: 'andEdge' | 'orEdge' = 'orEdge'
      if (current.selector === undefined) {

      }
      const edge = new RuleEdge(n, combinator ? getNodeStack(combinator, nodeStack) : nodeStack)
      if (current.andEdge) {
        if (Array.isArray(current.andEdge)) {
          current.andEdge.push(edge)
        } else {
          current.andEdge = [current.andEdge, edge]
        }
      }
      this.combinator = undefined
    }
    this.current = node
    return node
  }

  addSelectorList(n: tree.SelectorList, nodeStack: NodeStack) {
    this.current = new SelectorTreeNode(undefined)
  }

  addComplexSelector(n: tree.ComplexSelector, nodeStack: NodeStack) {
    n.value.forEach(s => this.add(s, nodeStack))
  }

  addCompoundSelector(n: tree.CompoundSelector, nodeStack: NodeStack) {
    n.value.forEach(s => this.add(s, nodeStack))
  }

  addPseudoSelector(n: tree.PseudoSelector<{ value: string, arg: tree.Node }>, parents?: Parents) {
    const mergedParents = parents ? [n, ...parents] : [n]
    this.add(n.arg, mergedParents)
  }
}