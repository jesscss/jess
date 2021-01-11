import type { Node } from './tree'
import type { Context } from './context'

/**
 * Given a root node and context, we can render
 */
export const render = (root: Node, context: Context) => {
  const evaldRoot = root.eval(context)
  const result = {
    __CSS: evaldRoot.toCSS(context),
    ...Array.from(context.exports)
  }
  return result
}