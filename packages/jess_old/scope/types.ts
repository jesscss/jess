/**
 * Jess maps all rules (declarations, qualifiedRules, atRules)
 * into primitive JavaScript types.
 */
import {
  type protectedScopes,
  type shadowScopes,
  type original,
  type rules,
  type selectorMap,
  type register,
  type mixinMap,
  type context,
  type mixinArgs
} from './symbols'

export type GenericObject = Record<string | symbol, any>

/**
  function() {
    const $ = this ?? {}
    // Lazy evaluation
    decl('prop', '$, [0,0,0])
    $['prop'] = computed(() => $['$var'])
    $['$var'] = ref('value')

    $[rules] = [
      // lists evaluation dependencies
      $ => $['prop'] = $['$var']],
      $ => $['$var'] = 'value'
    ]
  }
 */

export type Languages = 'less' | 'scss' | 'jess'
export interface SelectorMap {
  [k: string]: true | SelectorMap
}

/** A CSS value */
class Expression<T = any> extends Array<T> {}
const foo = Expression.from([1, 2])
/**
 * e.g.
 *   $['color'] = 'black'
 *   $['color'] = $ => 'black' // used when it calculates a value
 */
export type Declaration = Expression | ((obj: ScopeObj) => Expression)

const bar: Declaration = foo
console.log(bar)

/**
 * This is the base object for Jess / Less / Sass trees.
 * We use it to store rules, variables, and mixins
 * for easy lookup and interoperability with JavaScript.
 */
export interface ScopeObj {
  [k: string | symbol]: any

  /**
   * These are imported scopes which cannot conflict
   * with in-scope identifiers.
   */
  [protectedScopes]: ScopeObj[]

  /**
   * These are imported scopes whose values can be
   * shadowed (over-written) by a local variable.
   */
  [shadowScopes]: ScopeObj[]

  /** To be referenced by the Proxy */
  [original]: GenericObject
  /** An array of rules */
  [rules]: Rule[]
  /**
   * Registering '#foo > .bar' creates a selector lookup map like:
   * {
   *   [map]: {
   *     '#foo': {
   *       '>': {
   *         '.bar': true
   *       }
   *     }
   *     '.bar': true
   *   }
   * }
   * This is used for :extend and language services
   *   e.g. if '.bar' is extended by '.extended-class',
   *        it will have '.bar': ['.extended-class'].
   *        Therefore selectors, when rendered, traverse the lookup tree
   */
  [selectorMap]: SelectorMap
  /** Registers selectors to the selector map */
  [register]: (
    selector: string[],
    extendSelector?: string[],
    matchAll?: boolean
  ) => void

  [mixinMap]?: Record<string, {
    mixins?: Array<(...args: any[]) => ScopeObj>
    default?: Array<(...args: any[]) => ScopeObj>
  }>

  [context]: Languages

  /** Arguments in a caller scope passed to a mixin */
  [mixinArgs]?: GenericObject
}