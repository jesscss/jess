import { JsKeyValue, JsCollection, JsNode, NodeMap } from '.'
import type { Context } from '../context'
import { OutputCollector } from '../output'
import { LocationInfo, Node } from './node'

/**
 * @let
 * 
 * @note
 * The lower-case API variant for this is `set()`,
 * see the note below.
 * 
 * @todo
 * Check that we're not redefining vars? To do that, we'd have to
 * address the todo in js-import to get a true list of scoped vars.
 * For now, JS will simply throw an eval error.
 */
export class Let extends JsNode {
  value: JsKeyValue

  toCSS(context: Context, out: OutputCollector) {
    out.add('@let ', this.location)
    this.value.toCSS(context, out)
  }

  recurseValue(value: Node, keys: string[], context: Context, out: OutputCollector) {
    const pre = context.pre
    if (value instanceof JsCollection) {
      out.add(`${keys.join('.')} = {}\n${pre}`)
      value.value.forEach(node => {
        this.recurseValue(node.value, [...keys, node.name.value], context, out)
      })
    } else {
      out.add(`${keys.join('.')} = $J.get($VARS, '${keys.join('.')}', `)
      value.toModule(context, out)
      out.add(`)\n${pre}`)
    }
  }

  toModule(context: Context, out: OutputCollector) {
    const name = this.value.name.value
    if (context.rootLevel === 0) {
      out.add(`export let ${name}`, this.location)
      context.exports.add(name)
    } else {
      if (context.rootLevel !== 1) {
        out.add(`let `)
      }
      if (context.rootLevel !== 1) {
        out.add(`${name} = `)
        this.value.value.toModule(context, out)
        return
      }
      this.recurseValue(this.value.value, [name], context, out)
    }
  }
}

/**
 * `let` is a reserved word, so we'll use `set`
 * for lower-case API
 */
export const set =
  (value: JsKeyValue | NodeMap, location?: LocationInfo) =>
    new Let(value, location)
