import type { Node } from './tree'
import { Context } from './context'
import { OutputCollector } from './output'

/**
 * Given a root node (usually from a module) render to CSS
 */
export const renderCss = (root: Node, context: Context) => {
  const evaldRoot = root.eval(context)
  const result = {
    $css: () => {
      const out = new OutputCollector
      evaldRoot.toCSS(context, out)
      return out.toString()
    },
    $root: evaldRoot
  }
  return result
}