import type { Node } from './tree'
import type { Context } from './context'
import { OutputCollector } from './output'


/**
 * Given a root node (usually from a module) render to CSS
 */
export const renderCss = (root: Node, context: Context) => {
  const evaldRoot = root.eval(context)
  const out = new OutputCollector
  evaldRoot.toCSS(context, out)
  const result = {
    $CSS: out.toString(),
    ...context.classMap
  }
  return result
}