import { defineType, type Node, type LocationInfo, type FileInfo } from './node'
import { Sequence, type SequenceOptions } from './sequence'
import { Anonymous } from './anonymous'

/**
 * A space-separated sequence of nodes,
 * which is how most CSS values are written.
 *
 * For convenience, wraps strings.
 */
export class Spaced extends Sequence {
  constructor(
    value: Node[] | string[] | { value: Node[] },
    location?: LocationInfo,
    options?: SequenceOptions,
    fileInfo?: FileInfo
  ) {
    if (Array.isArray(value)) {
      value = value.map(v => (typeof v === 'string' ? new Anonymous(v) : v))
    }
    super(value, location, options, fileInfo)
    const values = this.value

    /** Offset by 1 to put in pre-whitespace */
    for (let i = 1; i < values.length; i++) {
      values[i].pre = 1
    }
  }
  // toModule(context: Context, out: OutputCollector) {
  //   const loc = this.location
  //   out.add('$J.spaced([', loc)
  //   const length = this.value.length - 1
  //   this.value.forEach((n, i) => {
  //     if (i % 2 === 0) {
  //       n.toModule(context, out)
  //       if (i < length) {
  //         out.add(', ', loc)
  //       }
  //     }
  //   })
  //   out.add('])')
  // }
}

export const spaced = defineType(Spaced, 'Spaced')
