import type { Node } from './tree'
import type { Context } from './context'
import { OutputCollector } from './output'
import { updateSheet } from '@jesscss/patch-css'

/**
 * Given a root node (usually from a module) render to CSS
 */
export const renderCss = (root: Node, context: Context) => {
  let evaldRoot = root.eval(context)
  let result = {
    /**
     * @todo - patch document in browser
     */
    $toCSS: () => {
      let out = new OutputCollector()
      evaldRoot.toCSS(context, out)
      let css = out.toString()
      updateSheet(css, context.id)
      return css
    },
    $root: evaldRoot
  }
  return result
}