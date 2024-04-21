import type { Selector } from '../selector'
import { SimpleSelector } from '../selector-simple'
import { Ampersand } from '../ampersand'
import { Combinator } from '../combinator'
import { SelectorList } from '../selector-list'

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
