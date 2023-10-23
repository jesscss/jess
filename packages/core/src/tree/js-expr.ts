import { type Context } from '../context'
import { Node, defineType } from './node'
import { cast } from './util/cast'

/**
 * Deprecated Less feature.
 */
export class JsExpression extends Node<string> {
  toTrimmedString(): string {
    return '`' + this.value + '`'
  }

  /**
   * @todo - install deno-bin to run scripts securely
   */
  async eval(context: Context) {
    // eslint-disable-next-line no-eval
    const result = await eval(this.value)
    return cast(result)
  }
}
export const js = defineType(JsExpression, 'JsExpression', 'js')