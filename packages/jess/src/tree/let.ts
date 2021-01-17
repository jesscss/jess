import { JsKeyValue, JsNode, NodeMap } from '.'
import type { Context } from '../context'
import { OutputCollector } from '../output'
import { ILocationInfo, Node } from './node'

/**
 * @let
 * 
 * @note
 * The lower-case API variant for this is `set()`,
 * see the note below.
 */
export class Let extends JsNode {
  value: JsKeyValue

  toCSS(context: Context, out: OutputCollector) {
    out.add('@let ', this.location)
    this.value.toCSS(context, out)
  }

  toModule(context: Context, out: OutputCollector) {
    const name = this.value.name
    if (context.rootLevel === 1) {
        out.add(`let ${name} = $JESS.assign($BK_${name}, rest.${name})`)
    } else {
      if (context.rootLevel === 0) {
        context.exports.add(name)
        out.add('export ', this.location)
      }
      out.add(`let ${name} = `)
      this.value.value.toModule(context, out)
      if (context.rootLevel === 0) {
        out.add(`\nlet $BK_${name} = ${name}`)
      }
    }
  }
}

/**
 * `let` is a reserved word, so we'll use `set`
 * for lower-case API
 */
export const set =
  (value: JsKeyValue | NodeMap, location?: ILocationInfo) =>
    new Let(value, location)
