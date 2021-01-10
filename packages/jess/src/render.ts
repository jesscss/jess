import type { Node } from './tree'
import type { Context } from './context'

/**
 * Given a root node and context, we can render
 */
export const render = (root: Node, context: Context) => {
  const evaldRoot = root.eval(context)
  return {
    __CSS: evaldRoot.toCSS(context)
  }
}