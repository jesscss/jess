import { type Selector } from '../selector'
import { SimpleSelector } from '../selector-simple'
import { Ampersand } from '../ampersand'
import { Combinator } from '../combinator'
import { SelectorList } from '../selector-list'
import { ComplexSelector, type ComplexSelectorValue } from '../selector-complex'
import { CompoundSelector, type CompoundSelectorValue } from '../selector-compound'
import { PseudoSelector } from '../selector-pseudo'
import { BasicSelector } from '../selector-basic'
import { SelectorTree } from '../tree'
import { ABORT } from '../node'

export function combineKeys(
  a: Set<string> | string,
  b: Set<string> | string
): Set<string> {
  if (a instanceof Set) {
    if (b instanceof Set) {
      return a.union(b)
    } else {
      return (new Set(a)).add(b)
    }
  } else {
    if (b instanceof Set) {
      return (new Set(b)).add(a)
    } else {
      /** Both are strings */
      return new Set([a, b])
    }
  }
}

function _hasUnevaldAmpersand(sel: Selector) {
  let match = false
  sel.walkNodes(node => {
    if (node instanceof Ampersand && !node.value) {
      match = true
      return ABORT
    }
  })
  return match
}

export function hasUnevaldAmpersand(sel: Selector | SelectorList) {
  if (sel instanceof SelectorList) {
    return sel.value.some(_hasUnevaldAmpersand)
  }
  return _hasUnevaldAmpersand(sel)
}

/** Selector starts with a combinator */
function _isRelative(sel: Selector) {
  let match = false
  sel.walkNodes(node => {
    /** Stop at the first simple selector or combinator */
    if (node instanceof SimpleSelector) {
      return ABORT
    } else if (node instanceof Combinator) {
      match = true
      return ABORT
    }
  })
  return match
}

export function isRelative(sel: Selector | SelectorList) {
  if (sel instanceof SelectorList) {
    return sel.value.every(_isRelative)
  }
  return _isRelative(sel)
}

/**
 *
 *  1. Each list in each :is is a start of a new search in a selector.
 *  2. Flatten :is() only if it contains simple selectors or compounds.
 *
 */
export function normalize(selector: Selector | SelectorList) {
  if (selector instanceof SelectorList) {
    const sel = selector.clone()
    sel.value = sel.value.map(normalize)
    return sel
  }

  if (
    selector instanceof ComplexSelector
    || selector instanceof CompoundSelector
  ) {
    const { value } = selector
    let length = value.length

    let paths: Selector[] = []
    let topCompound: SimpleSelector[] = []
    /** Iterate backwards; it's easier to build from :is() statements */
    for (let i = length - 1; i >= 0; i--) {
      let node = value[i]!.normalize()
      if (node instanceof BasicSelector) {
        paths.unshift(node)
      }
      if (node instanceof PseudoSelector && node.value === ':is') {
        let path = node.arg as Selector | SelectorList
      } else {

      }
    }
  }
}

export function getTreeNode(sel: Selector | Combinator): SelectorTree {
  if (sel instanceof PseudoSelector && sel.value === ':is') {
    let value = sel.arg as Selector
    if (value instanceof SelectorList) {
      const list = value.value.map(getTreeNode)
      return new SelectorTree(sel, list, 'is')
    } else {
      return new SelectorTree(sel, [getTreeNode(value)], 'is')
    }
  } else if (sel instanceof CompoundSelector) {
    return new SelectorTree(sel, sel.value.map(getTreeNode).flat(1), 'compound')
  } else if (sel instanceof ComplexSelector) {
    let { value } = sel
    let length = value.length
    let tree = getTreeNode(value[length - 1]!)
    let currentTree = tree
    for (let i = length - 2; i >= 0; i--) {
      let node = value[i]!
      let childrenTree = getTreeNode(node)
      currentTree.children.push(childrenTree)
      currentTree = childrenTree
    }
    return new SelectorTree(sel, [tree], 'complex')
  }
  return new SelectorTree(sel)
}

export function getSelectorFromTree(tree: SelectorTree): Selector | Combinator {
  let { type, value, children } = tree

  switch (type) {
    case 'compound': {
      return (
        new CompoundSelector([...tree.children].map(getSelectorFromTree) as CompoundSelectorValue)
      ).inherit(value)
    }
    case 'complex': {
      let current = children
      let nodes = []
      while (current.size) {
        let branch = current.first!
        nodes.unshift(getSelectorFromTree(branch))
        current = branch.children
      }
      return new ComplexSelector(nodes as ComplexSelectorValue).inherit(value)
    }
    case 'is': {
      const selectorsFromTree = children.toArray().map(getSelectorFromTree)
      return new PseudoSelector([
        ['value', ':is'],
        ['arg', selectorsFromTree.length === 1 ? selectorsFromTree[0] : new SelectorList(selectorsFromTree as Selector[])]
      ]).inherit(value)
    }
    default:
      return value
  }
}