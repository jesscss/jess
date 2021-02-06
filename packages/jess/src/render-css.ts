import type { Node } from './tree'
import { Context } from './context'
import { OutputCollector } from './output'
import { updateSheet } from '@jesscss/patch-css'

/**
 * Given a root node (usually from a module) render to CSS
 */
export const renderCss = (root: Node, context: Context) => {
  const evaldRoot = root.eval(context)
  const result = {
    /**
     * @todo - patch document in browser
     */
    $toCSS: () => {
      const out = new OutputCollector
      evaldRoot.toCSS(context, out)
      const css = out.toString()
      updateSheet(css, context.id)
      return css
    },
    $root: evaldRoot
  }
  return result
}