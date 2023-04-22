import { selectorMap } from "./symbols"
import type { ScopeObj } from "."

export function registerSelectors(
  this: ScopeObj,
  selector: string[]
) {
  const ext = this[selectorMap]
  /** @todo - fix type */
  let path: any = ext
  for (let i = 0; i < selector.length; i++) {
    const sel = selector[i]
    if (path === ext && path[sel] === true) {
      path[sel] = {}
    }
    if (!path[sel]) {
      if (/[>|+~\s]/.test(sel[0])) {
        path[sel] = {}
      } else {
        path[sel] = i === selector.length - 1 ? true : {}
        if (!ext[sel]) {
          ext[sel] = true
        }
      }
    }
    path = path[sel]
  }
}

export function registry(
  this: ScopeObj,
  selector: string[],
  extendSelector?: string[],
  matchAll?: boolean
) {
  registerSelectors.call(this, selector)
  if (extendSelector) {
    registerSelectors.call(this, extendSelector)
  }
}