import { defineType, Node, type NodeData } from './node'

/**
 * A collection is essentially like an anonymous mixin,
 * except that properties are arbitrary, so its intended
 * for map data.
 *
 * Can be used like Sass property nesting.
 * @see https://sass-lang.com/documentation/style-rules/declarations/#nesting
 */
export class Collection extends Node<Node[]> {
  declare value: Node[]
  declare data: NodeData<Node[]>
  type = 'Collection' as const
  shortType = 'coll' as const

  override toTrimmedString(depth: number = 0) {
    let space = ''.padStart(depth * 2)
    let output = '{\n'
    depth += 1
    space = ''.padStart(depth * 2)
    let outputs = this.value.map(n => n.toString(depth))
    output += space + outputs.join(`\n${space}`)
    depth -= 1
    space = ''.padStart(depth * 2)
    output += `\n${space}}`
    return output
  }
}

type Params = ConstructorParameters<typeof Collection>

export const coll = defineType(Collection, 'Collection', 'coll') as (
  value: Params[0],
  options?: Params[1],
  location?: Params[2],
  treeContext?: Params[3]
) => Collection