import { JsNode } from '.'
import type { LocationInfo } from './node'
import type { Context } from '../context' 
import { OutputCollector } from '../output'

/**
 * @import { foo } from './something.js';
 * 
 * @todo - for alpha, we just store the raw string
 * Later, we should collect identifiers
 */
export class JsImport extends JsNode {
  value: string

  toCSS(context: Context, out: OutputCollector) {
    out.add('[[JS]]', this.location)
  }

  toModule(context: Context, out: OutputCollector) {
    if (context.rootLevel === 0) {
      out.add(`import${this.value}`, this.location)
    }
  }
}

export const jsimport =
  (value: string, location?: LocationInfo) =>
    new JsImport(value, location)