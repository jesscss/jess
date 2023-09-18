import { defineType } from './node'
import { Ruleset } from './ruleset'

/**
 * A Jess kind of dictionary / map construct
 */
export class Collection extends Ruleset {
  toTrimmedString(depth: number = 0) {
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

export const coll = defineType(Collection, 'Collection', 'coll')