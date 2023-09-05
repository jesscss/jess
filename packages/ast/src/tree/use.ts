
import { Node, defineType } from './node'

export type UseOptions = {
  /** Make mixins, vars available */
  use?: boolean
  /** Output selectors */
  include?: boolean
}

export type UseValue = {
  path: string

  /** e.g. `import foo` is a namespace of foo */
  namespace?: string
  /**
   * - In array,
   *   - string is a plain import identifier
   *   - [string, string] is { [identifier1] as [identifier2] }
  */
  imports: string | Array<string | [string, string]>

  /**
   * Treat import as one of registered types.
   * Will use that type as parser and evaluator.
   */
  type: string
}

/**
 * This is a generic class for:
 *   - Less, Sass+, Jess `@use`
 *   - Less, Sass+, Jess `@include`
 *   - Less and Sass `@import` that are indicated to be processed by the engine
 *
 * `@use` values will be passed to Jess plugins
 *
 * @see https://sass-lang.com/documentation/at-rules/import/
 */
export class Use extends Node<UseValue, UseOptions> {
  get path() {
    return this.valueMap.get('path')
  }
}

export const use = defineType<UseValue>(Use, 'Use')
