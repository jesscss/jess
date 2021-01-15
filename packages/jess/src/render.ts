import type { Node } from './tree'
import type { Context } from './context'
import { OutputCollector } from './output'
/**
 * Given a root node and context, we can render
 */
export const render = (root: Node, context: Context) => {
  const evaldRoot = root.eval(context)
  const out = new OutputCollector
  evaldRoot.toCSS(context, out)
  const result = {
    $CSS: out.toString(),
    ...context.classMap
  }
  return result
}