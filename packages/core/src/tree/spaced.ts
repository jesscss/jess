import { defineType, type Node, type LocationInfo, type FileInfo } from './node'
import { Sequence, type SequenceOptions } from './sequence'

/**
 * A space-separated sequence of nodes,
 * which is how most CSS values are written.
 */
export class Spaced extends Sequence {
  constructor(
    value: Node[],
    location?: LocationInfo,
    options?: SequenceOptions,
    fileInfo?: FileInfo
  ) {
    /** Offset by 1 to put in pre-whitespace */
    for (let i = 1; i < value.length; i++) {
      value[i].pre = 1
    }

    super(value, location, options, fileInfo)
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
