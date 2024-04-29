import { type Selector } from '../selector'
import { SimpleSelector } from '../selector-simple'
import { Ampersand } from '../ampersand'
import { Combinator } from '../combinator'
import { SelectorList } from '../selector-list'
import { ComplexSelector } from '../selector-complex'
import { CompoundSelector, type CompoundSelectorValue } from '../selector-compound'
import { PseudoSelector } from '../selector-pseudo'
import { PseudoFunction } from '../selector-pseudofn'
import { BasicSelector } from '../selector-basic'

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

function _isRelative(sel: Selector) {
  let match = false
  sel.walkNodes(node => {
  /** Stop at the first simple selector or combinator */
    if (node instanceof SimpleSelector) {
      if (node instanceof Ampersand) {
        match = true
      }
      return false
    } else if (node instanceof Combinator) {
      match = true
      return false
    }
  })
  return match
}

export function isRelative(sel: Selector | SelectorList) {
  if (sel instanceof SelectorList) {
    return sel.value.some(_isRelative)
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
