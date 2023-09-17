import { Node, defineType, type LocationInfo, type FileInfo, type NodeOptions } from './node'
import { SelectorSequence } from './selector-sequence'
import { type SimpleSelector } from './selector-simple'
import { type Combinator } from './combinator'
import { type Context } from '../context'

/** Constructs */
export class SelectorList extends Node<SelectorSequence[]> {
  constructor(
    nodes: Array<Array<SimpleSelector | Combinator>>,
    location?: LocationInfo | 0,
    options?: NodeOptions,
    fileInfo?: FileInfo
  ) {
    let newNodes = nodes.map(seq => seq instanceof SelectorSequence ? seq : new SelectorSequence(seq))
    super(newNodes, location, options, fileInfo)
  }

  /** @todo? Lists should collapse nested lists? */
  async eval(context: Context) {
    return await (super.eval(context) as Promise<SelectorList>)
  }
}

export const sellist = defineType(SelectorList, 'SelectorList', 'sellist')