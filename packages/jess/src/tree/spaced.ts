import { Expression } from '.'
import type { Node } from './node'
import type { Context } from '../context'
import { OutputCollector } from '../output'

/**
 * A space-separated expression
 * 
 * @todo - In Less, we had an issue of later wanting to
 * explicitly store white-space & comments (especially b/c
 * without it, it makes variable merging in selectors
 * complicated). Should we do that instead of extending
 * Expression?
 */
export class Spaced extends Expression {
  value: Node[]
  
  toCSS(context: Context, out: OutputCollector) {
    const value = this.value
    const length = value.length - 1
    value.forEach((node, i) => {
      node.toCSS(context, out)
      if (i < length) {
        out.add(' ')
      }
    })
  }

  toModule(context: Context, out: OutputCollector) {
    out.add(`_J.spaced([`, this.location)
    const length = this.value.length - 1
    this.value.forEach((node, i) => {
      node.toModule(context, out)
      if (i < length) {
        out.add(', ')
      }
    })
    out.add(`])`)
  }
}

export const spaced =
  (...args: ConstructorParameters<typeof Spaced>) =>
    new Spaced(...args)