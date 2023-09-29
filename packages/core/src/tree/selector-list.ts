import {
  Node, defineType,
  type LocationInfo,
  type TreeContext,
  type NodeOptions,
  type TypeMap
} from './node'
import { SelectorSequence } from './selector-sequence'
import { type SimpleSelector } from './selector-simple'
import { type Combinator } from './combinator'
import { type Context } from '../context'

/** Constructs */
export class SelectorList extends Node<SelectorSequence[]> {
  constructor(
    nodes: TypeMap<{ value: SelectorSequence[] }> | Array<SelectorSequence | Array<SimpleSelector | Combinator>>,
    options?: NodeOptions,
    location?: LocationInfo | 0,
    treeContext?: TreeContext
  ) {
    /** When cloning, nodes will be a map */
    let newNodes = nodes instanceof Map
      ? nodes
      : (nodes as any[]).map(seq => seq instanceof SelectorSequence ? seq : new SelectorSequence(seq))
    super(newNodes, options, location, treeContext)
  }

  toTrimmedString() {
    return this.value.map(v => v.toString()).join(', ')
  }

  async eval(context: Context): Promise<SelectorList | SelectorSequence> {
    return await this.evalIfNot(context, async () => {
      const list = await (super.eval(context) as Promise<SelectorList>)
      const { value } = list
      if (value.length === 1) {
        return value[0]
      }
      return list
    })
  }
}

export const sellist = defineType(SelectorList, 'SelectorList', 'sellist')