import { JsNode } from '.'
import type { ILocationInfo } from './node'
import type { Context } from '../context' 
import { OutputCollector } from '../output'

/**
 * @import { foo } from './something.js';
 * 
 * @todo - for now, we just store the raw string
 * `value` is everything before `from`
 * `path` is the file path
 */
export class JsImport extends JsNode {
  value: string
  path: string

  toCSS(context: Context, out: OutputCollector) {
    out.add('[[JS]]', this.location)
  }

  toModule(context: Context, out: OutputCollector) {
    out.add(`import ${this.value} from ${this.path}`, this.location)
  }
}

export const jsimport =
  (value: string, location?: ILocationInfo) =>
    new JsImport(value, location)