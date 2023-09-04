
import { Node } from './node'

export type UseOptions = {
  /** Make mixins, vars available */
  use?: boolean
  /** Output selectors */
  include?: boolean
}

export type UseValue = {
  path: string
  imports: string | Array<string | [string, string]>
}

/**
 * This is a generic class for:
 *   - Less, Sass+, Jess `@use`
 *   - Less, Sass+, Jess `@include`
 *   - Less and Sass `@import` that are indicated to be processed by the engine
 *
 * @see https://sass-lang.com/documentation/at-rules/import/
 */
export class Use extends Node<UseValue, UseOptions> {
  get path() {
    return this.valueMap.get('path')
  }
}
