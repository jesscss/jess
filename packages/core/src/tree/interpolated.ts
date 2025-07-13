import { type Node, defineType } from './node'
import { General, type GeneralNodeType, type GeneralOptions } from './general'
import type { Context } from '../context'
import { isNode } from './util/is-node'
import { BasicSelector } from './selector-basic'
import { SelectorList } from './selector-list'
import { SimpleSelector } from './selector-simple'

export type InterpolatedValue = {
  /** String with {} placeholders */
  source: string
  replacements: Node[]
}

/**
 * Merge an interface to declare the specific types
 */
export interface Interpolated<
  T extends string = GeneralNodeType
> extends SimpleSelector<InterpolatedValue, GeneralOptions<T>> {
  eval(context: Context): Promise<Interpolated<T>>
}
/**
 * An interpolated value is one that contains
 * reference variables, or expressions, but
 * which MUST resolve to a node with a string value
 * (like Anonymous) when evaluated.
 *
 * @example
 *   in Less:
 *     - `@@foo` is an interpolated variable
 *     - `--prop-@{foo}` is an interpolated property
 */
export class Interpolated<
  T extends string = GeneralNodeType
> extends SimpleSelector<InterpolatedValue, GeneralOptions<T>> {
  type = 'Interpolated' as const
  shortType = 'interpolated' as const

  override valueOf(): string {
    return this.value.source
  }

  replace(replacements: Node[]): string {
    let { source } = this.value
    let output = source
    let i = 0
    output = output.replace(/{}/g, _ => {
      return replacements[i++]?.toTrimmedString() ?? ''
    })
    return output
  }

  override toTrimmedString(): string {
    return this.replace(this.value.replacements)
  }

  /**
   * Can turn simple #id, .class, element and list into a selector
   */
  createSelector() {
    let { source, replacements } = this.value
    let segments = source.split('{}')
    let output = ''
    let list: string[] = []
    for (let [i, replacement] of replacements.entries()) {
      if (!replacement.evaluated) {
        throw new Error('Cannot create selector from un-evaluated interpolated node')
      }
      if (isNode(replacement, 'List')) {
        for (let item of replacement.value) {
          list.push(this.replace([item, ...replacements.slice(i + 1)]))
        }
      } else {
        output += (segments[i] ?? '') + replacement.toTrimmedString()
      }
    }
    if (!list.length) {
      return new BasicSelector(output).inherit(this)
    } else {
      return new SelectorList(
        list.map(item => new BasicSelector(item))
      ).inherit(this)
    }
  }

  createGeneric() {
    return new General<T>(this.toTrimmedString()).inherit(this)
  }

  /**
   * Just evaluate replacements and return. We don't stringify yet,
   * because depending on the context, it will turn into different
   * node types.
   */
  override async evalNode(context: Context) {
    let node = this.maybeClone(context)
    let { replacements } = node.value
    node.value.replacements = await Promise.all(replacements.map(async (n: Node) => await n.eval(context)))
    return node
  }
}

export const interpolated = defineType(Interpolated, 'Interpolated')