
import { Node, defineType } from './node'
import { type Reference } from './reference'
import { type Rules } from './rules'

/**
 * This class is for Jess / Sass+ / Less-style imports,
 * not the CSS `@import` rule. The two will be distinguished
 * during parsing.
 *
 * @see https://sass-lang.com/documentation/at-rules/import/#plain-css-imports
 */
export type ImportOptions = {
  /** Make mixins & vars available, set to `true` with `@import` */
  reference?: boolean
  /** Output selectors, set to `true` with `@import` */
  include?: boolean
  /** Classic `@import` in Less/Sass doesn't have isolated scope */
  useParentScope?: boolean
  /** JS/TS (or modules compiled to JS) imports */
  from?: boolean
}

export type ImportValue = {
  path: string

  /** Values to inject */
  with?: Reference | Rules

  /** e.g. `import * as foo` sets namespace to `foo` */
  namespace?: string
  /**
   * - In array,
   *   - string is a plain import identifier
   *   - [string, string] is { [identifier1] as [identifier2] }
  */
  imports?: string | Array<string | [string, string]>

  /**
   * Treat import as one of registered types.
   * Will use that type as parser and evaluator.
   */
  importType: string

  /** Options passed to the Jess import plugin */
  pluginOptions?: Record<string, any>
}

/**
 * This is a generic class for:
 *   - Less, Sass+, Jess `@use`
 *   - Less, Sass+, Jess `@include`
 *   - Less, Jess `@from`
 *   - Less and Sass `@import` that are indicated to be processed by the engine
 *
 * `@use` values will be passed to Jess plugins
 *
 * @see https://sass-lang.com/documentation/at-rules/import/
 */
export class Import extends Node<ImportValue, ImportOptions> {
  get path() {
    return this.data.get('path')
  }

  set path(v: string) {
    this.data.set('path', v)
  }

  get namespace() {
    return this.data.get('namespace')
  }

  get imports() {
    return this.data.get('imports')
  }

  get importType() {
    return this.data.get('importType')
  }
}

export const use = defineType<ImportValue>(Import, 'Import', 'use')
