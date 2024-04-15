import { logger } from '../logger'
import { Declaration } from '../tree/declaration'
import { AssignmentType } from '../tree/base-declaration'
import { List } from '../tree/list'
import { Spaced } from '../tree/spaced'
import type { Node } from '../tree/node'
import type { Mixin } from '../tree/mixin'
import isPlainObject from 'lodash-es/isPlainObject'
import { isNode } from '../tree/util'
import { cast } from '../tree/util/cast'
import { Rules } from '../tree/rules'
import type { Bool } from '../tree/bool'
import type { Condition } from '../tree/condition'
import { Context } from '../context'
import type { General } from '../tree/general'
import type { Keys, Selector } from '../tree/selector'
import { PseudoSelector } from '../tree/selector-pseudo'
import { SimpleSelector } from '../tree/selector-simple'
import { SelectorList } from '../tree/selector-list'
import { CompoundSelector } from '../tree/selector-compound'
import { type ComplexSelector } from '../tree/selector-complex'
/**
 * The Scope object is meant to be an efficient
 * lookup mechanism for variables, mixins,
 * and other identifiers (including selectors).
 *
 * It leverages the prototype chain for quick scope
 * lookup, and provides a language-agnostic interface
 * for determing behavior when setting identifiers.
 */
export type ScopeEntryOptions = {
  /**
   * These are from JS import statements
   */
  protected?: boolean
  /**
   * Imports from JS/TS are already normalized
   */
  isNormalized?: boolean

  setDefined?: boolean
  setIfUndefined?: boolean
  throwIfDefined?: boolean

  /**
   * Preserve previous entries. Used by Jess/Less for mixins.
   */
  preserve?: boolean

  /**
   * A variable marked private.
   * In SCSS, this is any variable starting with a dash.
   */
  private?: boolean
}

const { isArray } = Array
/**
 * We use this to store meta-information
 * about keys / values. For example, values
 * from imports are protected.
 */
export class ScopeEntry<T = unknown> {
  options: ScopeEntryOptions
  key: string
  value: T | undefined

  constructor(key: string, value?: T, opts?: ScopeEntryOptions) {
    this.key = key
    this.value = value
    this.options = opts ?? {}
  }
}

export type MixinEntry = Mixin | Rules
export type ScopeEntryMap<T = unknown> = Record<string, ScopeEntry<T> | undefined>
export type PropMap = Record<string, Declaration | Declaration[]>

/**
 * For JS interoperability,
 * we cannot allow these identifiers
 */
const RESERVED = [
  'enum',
  'implements',
  'interface',
  'let',
  'package',
  'private',
  'protected',
  'public',
  'static'
]

type FilterResult = {
  value: unknown
  done: boolean
}

export type GetterOptions = {
  /** Filter is a function or value to compare when looking up values */
  filter?: Node | ((value: any, foundValues?: any[]) => FilterResult)

  /** Only return local values, not all scope values */
  local?: boolean
  /**
   * Right now used by Less for functions
   */
  suppressUndefinedError?: boolean
}

export type ScopeFilter = (
  entry: ScopeEntry | undefined,
  valueFilter: (value: any, index?: number, entryValue?: any[]) => boolean
) => ({ value: unknown, done: boolean })
/**
 * This should be extended by each language
 */
export class Scope {
  static allScopes: Scope[] = []
  id = Scope.allScopes.length
  /**
   * Includes vars but also
   * imported functions, JS identifiers, etc
   */
  _vars: ScopeEntryMap
  /**
   * @note - For Jess, we could have stored all
   * mixins in the vars map, but other languages
   * need more dis-ambiguation.
   */
  _mixins: ScopeEntryMap<MixinEntry>
  _props: PropMap
  _parent?: Scope

  _extendMap = new Map<string, {
    complete: Array<SimpleSelector | CompoundSelector | ComplexSelector>
    partial: Array<SimpleSelector | CompoundSelector | ComplexSelector>
    continue: string[]
  }>()

  /**
   * We store a set (copy) of all extended selectors
   * so that we can quickly do Set.prototype.isDisjointFrom
   * for selectors to see if they can be extended.
   *
   * @see https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Set/isDisjointFrom
   */
  _extendSet = new Set<string>()

  /**
   * For none found. Use this to distinguish from
   * found but has a value of undefined.
   *
   * Not sure if this is needed, but works.
   */
  static NONE = Symbol('None')

  /**
   * Keys are normalized to camelCase, therefore we should
   * warn when a key is normalized differently
   */
  static entryKeys = new Map<string, string>()
  /** If we already normalized, don't re-normalize */
  static cachedKeys = new Map<string, string>()

  constructor(parent?: Scope) {
    Scope.allScopes.push(this)
    this._parent = parent
    /**
     * Assign to parent entries at first.
     * This allows us to lazily extend the prototype chain.
     *
     * If no keys are ever assigned, we can just lookup
     * keys from the parent scope.
     */
    // if (parent) {
    //   this._vars = parent._vars
    //   this._props = parent._props
    //   this._mixins = parent._mixins
    // } else {
    //   this._vars = Object.create(null)
    //   this._props = Object.create(null)
    //   this._mixins = Object.create(null)
    // }
  }

  /**
   * This just "registers" extend statements.
   * #0[] = compound array
   * #1[] = complex array
   * #2[] = selector list
   *
   * 1. .one>.two.three
   *    #1[.one, >, #0[.two, .three]]
   *    i -> .two:extend(.three !all)
   *    o -> #1[.one, > , #0[.two, #2[.three, .two]]]
   *    o -> .one>:is(.two, .three)
   *
   * 2. #1[.one, >, #0[.two, .three]]
   *    .one>.two.three
   *    Given: we extend one element
   *    i -> .four:extend(.three !all)
   *    Then: we need to wrap that in an :is()
   *    o -> #1[.one, >, #0[.two, #2[.three, .four]]]
   *    0 -> .one>.two:is(.three, .four)
   *
   *    Given: we extend two elements that overlaps an :is()
   *    i -> .five:extend(.two.three !all)
   *    Then: we need to extend the :is() and distribute
   *    o -> #1[.one, >, #2[#0[.two, #2[.three,.four]], .five]]
   *    o -> .one>:is(.two:is(.three, .four), .five)
   *
   *    i -> .six:extend(.two !all)
   *    o -> #1[.one, >, #2[#0[#2[.two, .six], #2[.three, .four]]], .five]]
   *    o -> .one>:is(:is(.two, .six):is(.three, .four), .five)
   *
   *    i -> .seven:extend(.one>.two !all)
   *    Not sure how to do this, but it should be:
   *    o -> .one>:is(:is(.two, .six):is(.three, .four), .five), .seven:is(.three, .four)
   *      OR
   *    :is(.one>.two, .seven):is(.three, .four), .one > :is(.six:is(.three, .four), .five)
   *      The second is probably easiest - if the extend doesn't match the whole list,
   *      then duplicate the first part of the list and add it to the outer list....
   *      No... the first is easiest. Grab the remainder of the match and attach to .seven?
   *      ... except, what if .two is extended again?
   *
   * Map would be:
   *    Map {
   *      .three => { complete: [], partial: [.four], continue: [] }
   *      .two => { complete: [], partial: [.six], continue: [.three] }
   *      .two.three => { complete: [], partial: [.five], continue: [] }
   *      .one => { complete: [], partial: [], continue: [>] }
   *      .one> => { complete: [], partial: [], continue: [.two] }
   *      .one>.two => { complete: [], partial: [.seven], continue: [] }
   *    }
   *    Render .one > .two.three {}
   *      1. Look up .one
   *      2. Match > to continue, look up .one>
   *      3. Match .two to continue, look up .one>.two
   *      4. Wrap .one>.two with .seven :is(.one>.two, .seven)
   *      5. Continue on modified selector from '>'
   *      6. Look up .two
   *      7.
   *
   *    Render .one > .two.three {}
   *      1. Start with simple selectors
   *      2. Look up .one (none)
   *      3. Look up .two (match)
   *      4. Extend .two with .six -> .one > :is(.two, .six).three
   *      5. Look up .three (match)
   *      6. Extend .three with .four -> .one > :is(.two, .six):is(.three, .four)
   *      7. Match sequences (on original selector?)
   *      8. Look up .one
   *      9. Match > to continue, look up .one>
   *      10. Look up continue, match .one>two
   *      11. Extend .one>.two with .seven -> :is(.one > :is(.two, .six), .seven):is(.three, .four)
   *      12. Continue to next sequence (skip combinators)
   *      13. Look up .two
   *      14. Match .three to continue, look up .two.three
   *      15. Extend .two.three with .five -> :is(.one > :is(.two, .six), .seven):is(.three, .four)
   *          ...shit ... how do we get to :is(.one>.two, .seven):is(.three, .four), .one > :is(.six:is(.three, .four), .five)
   *
   * 3. .one[.two.three, .four]
   *    Given: a partial overlap of an :is()
   *    i -> .five:extend(.one.two)
   *    Then: wrap the last complete match
   *    o -> .one[[.two,.five].three, .four]
   */
  registerExtend(
    /** Given .a:extend(.b.c) {} */
    target: SimpleSelector | CompoundSelector | ComplexSelector /* .b.c */,
    extendWith: SimpleSelector | CompoundSelector | ComplexSelector /* .a */,
    all?: boolean
  ) {
    /** no, wrong... we need a linear array with duplicates and nested :is */
    let targetKeyList = target.keyList // target.keySet // ['.b', '.c']
    /** no, wrong, it's just one entry for .b */
    let next = targetKeyList[0]!
    // let pos: Selector

    const iteratePosition = (next: string | SelectorList): void => {
      if (next instanceof SelectorList) {
        return next.keyList.forEach(n => iteratePosition(n))
      }
      let mapEntry = this._extendMap.get(next)
      let map = mapEntry ?? {
        continue: [],
        complete: [],
        partial: []
      }
      let list = all ? map.partial : map.complete
      list.push(extendWith)
    }

    for (let i = 0; i < targetKeyList.length; i++) {
      iteratePosition(targetKeyList[i]!)

      next = targetKeyList[i + 1]!
      if (!next) {
        let list = all ? map.all : map.partial
        list.push(extendWith)
        if (!mapEntry) {
          this._extendMap.set(compositeKey, map)
          this._extendSet.add(compositeKey)
        }
      } else {
        compositeKey += next
      }
    }
    /**
     * Should end up with:
     * Map {
     *   '.b' => { all: [], partial: [], continue: ['.c'] }
     *   '.b.c' => { all: [], partial: [el('.a')], continue: [] }
     * }
     */
  }

  private _processSelector(input: Selector, matchSequence?: Selector): Selector | false {
    const extendMap = this._extendMap
    /**
     * .a {}
     * .b:extend(.a);
     * .c:extend(.a.b);
     *
     * okay... Given:
     *   1. input is .a
     *   2. extendMap has:
     *     Map {
     *       '.a' => { all: [], partial: ['.b'], continue: ['.b'] }
     *       '.a.b' => { all: [], partial: ['.c'], continue: [] }
     *     }
     */
    if (input instanceof SimpleSelector) {
      let primitive = input.valueOf() // .a
      let ref = extendMap.get(primitive)
      if (!ref) {
        return false
      }

      if (ref.partial.length || ref.all.length) {
        let selector = input.clone()
        const list: Array<Selector<any>> = [selector]
        let container = new PseudoSelector([
          ['name', ':is'],
          ['value', new SelectorList(list)]
        ])
        if (ref.partial.length) {
          list.push(...ref.partial)
        }
        if (ref.all.length) {
          list.push(...ref.partial)
        }
        return container
      }
    } else if (input instanceof CompoundSelector) {
      for (let selector of input.value) {
        let processed = this._processSelector(selector)
        if (processed) {
          return processed
        }
      }
    }
  }

  /** Get a selector, considering the extend map */
  getExtendedSelector(input: Selector): Selector {
    const extendSet = this._extendSet
    if (extendSet.size === 0 || input.keySet.isDisjointFrom(extendSet)) {
      return input
    }
    // return this._processSelector(input, seek)
  }

  // addSelector(selector: string) {
  //   const map = this._extendMap.get(selector)
  //   this._extendMap.set(selector, { extendedBy: [] })
  // }

  /** Normalizes keys as valid JavaScript identifiers. */
  normalizeKey(key: string) {
    let cachedKey = Scope.cachedKeys.get(key)
    if (cachedKey) {
      return cachedKey
    }
    /** @todo - can this be a single replace with the replacer function? */
    let normalKey = key
      /** Replace initial dash with underscore */
      .replace(/^-/, '_')
      /** Remove initial . (used by Less) */
      .replace(/^\./, '')
      /** Convert dash-case to camelCase, as well as leading '#' */
      .replace(/(^_)|(?:[#\-_])(.)/g, (_, p1 = '', p2 = '') => `${p1}${p2.toUpperCase()}`)

    if (RESERVED.includes(normalKey)) {
      logger.warn(`"${normalKey}" is a reserved identifier and is not exportable`)
    } else {
      /**
       * Quick way to identify a valid JS identifier -
       * try to create a variable with it.
       *
       * @see https://stackoverflow.com/questions/2008279/validate-a-javascript-function-name
       */
      try {
        // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new, no-new-func
        new Function(`let ${normalKey}`)
      } catch (err) {
        logger.warn(`"${key}" is not exportable`)
      }
    }

    let lookupKey = Scope.entryKeys.get(normalKey)
    if (lookupKey) {
      if (lookupKey !== key) {
        logger.warn(`${key} was previously normalized from ${lookupKey}, which could lead to unexpected behaviors.`)
      }
    }
    Scope.cachedKeys.set(key, normalKey)
    return normalKey
  }

  /**
   * Lazily create prototype chains
   * for improved performance.
   */
  getEntries(key: 'vars' | 'mixins'): ScopeEntryMap
  getEntries(key: 'props'): PropMap
  getEntries(key: 'vars' | 'props' | 'mixins'): ScopeEntryMap | PropMap {
    let privateKey: '_vars' | '_props' | '_mixins' = `_${key}`
    let currentEntries = this[privateKey]
    if (currentEntries) {
      return currentEntries
    }
    if (this._parent) {
      currentEntries = this[privateKey] = Object.create(this._parent[key])
    } else {
      currentEntries = this[privateKey] = Object.create(null)
    }
    return currentEntries
  }

  /** Merges a scope (usually child) into this scope object */
  merge(scope: Scope, leakVariablesIntoScope?: boolean) {
    let props = scope.props
    let keys = Object.getOwnPropertyNames(props)
    let keyLength = keys.length
    for (let i = 0; i < keyLength; i++) {
      let key = keys[i]!
      this.setProp(key, props[key]!)
    }
    if (leakVariablesIntoScope) {
      let leakVariables = (lookupKey: 'vars' | 'mixins') => {
        let importedVars = scope[lookupKey]
        let localVars = this[lookupKey]
        let setter = lookupKey === 'vars' ? this.setVar : this.setMixin
        let keys = Object.getOwnPropertyNames(importedVars)
        let keyLength = keys.length
        for (let i = 0; i < keyLength; i++) {
          let key = keys[i]!
          /** Only leak vars if they aren't defined */
          if (key in localVars && localVars[key]?.options.preserve !== true) {
            continue
          }
          let entry = importedVars[key]!
          if (!entry.options.private) {
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment, @typescript-eslint/prefer-ts-expect-error
            // @ts-ignore
            setter.call(this, key, entry)
          }
        }
      }
      leakVariables('vars')
      leakVariables('mixins')
    }
  }

  get mixins(): ScopeEntryMap {
    return this.getEntries('mixins')
  }

  get vars(): ScopeEntryMap {
    return this.getEntries('vars')
  }

  get props(): PropMap {
    return this.getEntries('props')
  }

  setProp(key: string, value: Declaration | Declaration[]) {
    let { props } = this
    Scope.cachedKeys.set(key, key)
    if (Object.prototype.hasOwnProperty.call(props, key)) {
      /** Modify the local entry */
      let entry = props[key]!

      props[key] =
        Array.isArray(entry)
          ? Array.isArray(value)
            ? [...value, ...entry]
            : [value, ...entry]
          : Array.isArray(value)
            ? [...value, entry]
            : [value, entry]
    } else {
      props[key] = value
    }
  }

  /**
   * This will store a scoped identifier
   * that is compatible with JS.
   */
  private _setVarOrMixin(lookupKey: 'var' | 'mixin', key: string, value: unknown, opts?: ScopeEntryOptions) {
    let vars = this[`${lookupKey}s`]
    if (value instanceof ScopeEntry) {
      vars[key] = value
      return
    }
    if (key.startsWith('$')) {
      throw new SyntaxError(`"${key}" cannot start with "$"`)
    }
    let normalKey: string
    if (opts?.isNormalized) {
      normalKey = key
    } else {
      normalKey = this.normalizeKey(key)
    }
    Scope.entryKeys.set(normalKey, key)

    if (normalKey in vars) {
      if (opts?.setIfUndefined) {
        return
      }
      let entry = vars[normalKey]!
      /**
       * These sort of do similar things, they just throw
       * different errors.
       */
      if (entry.options.protected ?? opts?.protected) {
        throw new SyntaxError(`Assignment to protected ${lookupKey} "${key}"`)
      }
      /** Set the already defined variable */
      if (opts?.setDefined) {
        entry.value = value
        return
      }
    } else if (opts?.setDefined) {
      throw new ReferenceError(`"${key}" is not defined`)
    }
    if (Object.prototype.hasOwnProperty.call(vars, normalKey)) {
      /** Modify the local entry */
      let entry = vars[normalKey]!

      if (entry?.options.throwIfDefined ?? opts?.throwIfDefined) {
        throw new SyntaxError(`"${key}" is already defined`)
      }

      if (lookupKey === 'var') {
        entry.value = Array.isArray(entry.value) ? [value, ...entry.value] : [value, entry.value]
      } else {
        /** mixins are in linear order */
        entry.value = Array.isArray(entry.value) ? [...entry.value, value] : [entry.value, value]
      }
    } else {
      /** Shadow the variable within the local scope */
      vars[normalKey] = new ScopeEntry(normalKey, value, opts)
    }
  }

  setVar(key: string, value: unknown, opts?: ScopeEntryOptions) {
    this._setVarOrMixin('var', key, value, opts)
  }

  setMixin(key: string, value: MixinEntry, opts?: ScopeEntryOptions) {
    this._setVarOrMixin('mixin', key, value, opts)
  }

  getVar(key: string, options?: GetterOptions) {
    return this._getBase('vars', key, options)
  }

  getMixin(key: string, options?: GetterOptions) {
    let mixins = this._getBase('mixins', key, options)
    if (mixins) {
      return getFunctionFromMixins(mixins)
    }
  }

  getProp(key: string, options: GetterOptions = {}) {
    let props: Declaration | Declaration[] = this._getBase('props', key, {
      filter(value: Declaration) {
        /**
         * Find all declarations, in case we need to merge
         */
        return { value, done: false }
      },
      ...options
    })
    /** Our last entry had a merge flag, so collect merges */
    if (Array.isArray(props)) {
      /**
       * If the most recent value is not a merge value
       * return this as the only value.
       */
      let assignment = props[0]!.options?.assign
      if (!(assignment === AssignmentType.MergeList || assignment === AssignmentType.MergeSequence)) {
        return props[0]
      }

      let length = props.length
      let values: Node[] = []
      let important: General<'Flag'> | undefined
      let merge: AssignmentType | undefined
      /**
       * Legacy property joining for Less -- note, we need to
       * explicitly wrap values in a list() when parsing
       */
      for (let i = length - 1; i >= 0; i--) {
        let decl = props[i]!
        let assignment = decl.options?.assign
        if (assignment === AssignmentType.MergeList || assignment === AssignmentType.MergeSequence) {
          merge = assignment
          values.push(decl.value)
          if (decl.important) {
            important = decl.important
          }
        }
      }
      key = props[0]!.name.toString()
      return new Declaration([
        ['name', key],
        ['value', merge === AssignmentType.MergeList ? new List(values) : new Spaced(values)],
        ['important', important]
      ])
    }

    return props
  }

  getLocal(
    collection: 'property' | 'mixin' | 'variable',
    key: string,
    options: GetterOptions = {}
  ) {
    let getter: (key: string, options?: GetterOptions) => unknown
    options = {
      ...options,
      local: true
    }

    switch (collection) {
      case 'property':
        getter = this.getProp
        break
      case 'mixin':
        getter = this.getMixin
        break
      case 'variable':
        getter = this.getVar
        break
    }
    return getter.call(this, key, options)
  }

  /**
   * We can pass in a filter to narrow the
   * entries.
   */
  private _getBase(collection: 'mixins', baseKey: string, options?: GetterOptions): MixinEntry | MixinEntry[] | undefined
  private _getBase(collection: 'vars' | 'props', baseKey: string, options?: GetterOptions): any
  private _getBase(collection: 'vars' | 'props' | 'mixins', baseKey: string, options: GetterOptions = {}): any {
    let NONE = Scope.NONE
    let key = this.normalizeKey(baseKey)
    let {
      /** By default, return the first value */
      filter = (value: unknown) => ({ value, done: true })
    } = options

    if (typeof filter !== 'function') {
      let filteredNode = filter
      filter = (value: unknown) => {
        if (value === filteredNode) {
          return { value: NONE, done: false }
        }
        return { value, done: true }
      }
    }
    /**
     * When getting, use the private variable,
     * so we don't extend the prototype chain.
     */
    let current: ScopeEntryMap | PropMap | undefined = this[collection]
    let results: any[] = []

    /**
     * In Less / Jess, mixins are defined / merged per scope
     * We don't climb the prototype chain, and they aren't filtered.
     */
    if (collection === 'mixins') {
      let entry = current[key]
      if (!entry) {
        if (options.suppressUndefinedError) {
          return undefined
        }
        throw new ReferenceError(`"${baseKey}" is not defined`)
      }
      return (entry as unknown as ScopeEntryMap).value
    }
    while (current) {
      let entry = (options.local && !Object.prototype.hasOwnProperty.call(current, key)) ? undefined : current[key]
      if (!entry) {
        if (options.suppressUndefinedError) {
          return undefined
        }
        throw new ReferenceError(`"${baseKey}" is not defined`)
      }
      let entryValue: unknown = collection === 'vars'
        ? (entry as unknown as ScopeEntryMap).value
        : entry
      let lastResult: FilterResult
      if (Array.isArray(entryValue)) {
        for (let i = 0; i < entryValue.length; i++) {
          let val = filter(entryValue[i], results)
          if (val.value !== NONE) {
            results.push(val.value)
          }
          lastResult = val
          if (val.done) {
            break
          }
        }
      } else {
        let val = filter(entryValue, results)
        lastResult = val
        if (val.value !== NONE) {
          results.push(val.value)
        }
      }

      if (lastResult!.done) {
        break
      }
      /** Traverse up the prototype chain */
      current = Object.getPrototypeOf(current)
    }
    let returnResult = results.length
      ? results.length === 1
        ? results[0]
        : results
      : NONE
    if (returnResult === NONE && !options.suppressUndefinedError) {
      throw new ReferenceError(`"${baseKey}" is not defined`)
    }
    return returnResult
  }
}

Scope.entryKeys = new Map()
Scope.cachedKeys = new Map()

/** Returns a plain JS function for calling a set of mixins */
export function getFunctionFromMixins(mixins: MixinEntry | MixinEntry[]) {
  let mixinArr = Array.isArray(mixins) ? mixins : [mixins]
  /**
   * This will be called by a mixin call or by JavaScript
   *
   * @note - Mixins resolve to async functions because they
   * can contain dynamic imports.
   */
  async function returnFunc(this: unknown, ...args: any[]): Promise<Rules | Record<string, string>>
  async function returnFunc(this: Context, ...args: any[]): Promise<Rules>
  async function returnFunc(this: Context | unknown, ...args: any[]) {
    const mixinLength = mixinArr.length
    let mixinCandidates: MixinEntry[] = []
    let evalCandidates: Array<[MixinEntry, number]>
    let thisContext = this instanceof Context ? this : new Context()
    /**
     * Check named and positional arguments
     * against mixins, to see which ones match.
     * (Any mixin with a mis-match of
     * arguments fails.)
     */
    let argEntries = isPlainObject(args[0]) ? Object.entries(args[0]) : null
    for (let i = 0; i < mixinLength; i++) {
      let mixin = mixinArr[i]!
      let isPlainRule = isNode(mixin, 'Rules')
      let paramLength = isPlainRule ? 0 : (mixin as Mixin).params?.length ?? 0
      if (!paramLength) {
        /** Exit early if args were passed in, but no args are possible */
        if (args.length) {
          continue
        }
        mixinCandidates.push(mixin)
      } else {
        /** The mixin has parameters, so let's check args to see if there's a match */
        let params = (mixin as Mixin).params.clone()
        let positions = new Set(params.value.map((_, i) => i))
        /**
         * First argument can be a plain object with named params
         * e.g. { a: 1, b: 2 }
         */
        let argPos = 0
        if (argEntries) {
          argPos = 1
          let namedMap = new Map(argEntries)
          /**
           * We iterate through params instead of args,
           * because we need to track the position
           * of each parameter.
           */
          for (let [i, param] of params) {
            if (isNode(param, 'VarDeclaration')) {
              let key = param.name as string
              let namedValue = namedMap.get(key)
              /** Replace our param value with the passed in named value */
              if (namedValue) {
                params.value[i] = cast(namedValue)
                /**
                 * Because we've assigned a named value, any
                 * positional arguments will be shifted.
                 */
                positions.delete(i)
                namedMap.delete(key)
              } else {
                /** This mixin is not a match */
                break
              }
            }
          }
          if (namedMap.size) {
            /** This mixin is not a match */
            continue
          }
        }
        /**
         * Now we can check remaining positional matches
         * against the remaining parameters.
         */
        if (args.length - argPos !== positions.size) {
          /** This mixin is not a match */
          continue
        }
        let match = true

        for (let i of positions) {
          let arg = args[argPos]
          let param = params.value[i]!
          if (isNode(param, 'VarDeclaration')) {
            param.value = cast(arg)
          } else if (isNode(param, 'Rest')) {
            param.value = new Spaced(args.slice(argPos))
            /** Check a pattern-matching node */
          } else if (param.compare(arg) !== 0) {
            /** This mixin is not a match */
            match = false
            break
          }
          argPos++
        }
        if (match) {
          (mixin as Mixin).params = params
          mixinCandidates.push(mixin)
        }
      }
    }
    /**
     * Alright, we have mixin candidates (mixins that match
     * by arity, pattern, and/or named arguments), now what?
     *
     * First, let's make an evaluation order that evaluates
     * default guards last.
     */
    let hasDefault = false
    evalCandidates = mixinCandidates
      .map<[MixinEntry, number]>(
      (candidate, i) => {
        let isDefault = candidate.options?.hasDefault
        if (isDefault) {
          if (hasDefault) {
            throw new Error('Ambiguous use of default guard found')
          }
          hasDefault = true
        }
        return [candidate, i]
      })

    if (hasDefault) {
      /** There is a default guard, so sort candidates */
      evalCandidates = evalCandidates.slice(0).sort((a, b) => {
        let aNode = a[0]
        let bNode = b[0]
        let aDefault = aNode.options?.hasDefault
        let bDefault = bNode.options?.hasDefault
        /** No guard (or is just a plain ruleset) */
        if (!aDefault && !bDefault) {
          return 0
        }

        if (!aDefault) {
          return 1
        }
        if (!bDefault) {
          return -1
        }
        return 0
      })
    }

    /**
     * Now we have a set of mixins that can return rulesets,
     * but first we need to create a new scope for each mixin,
     * and create variable declarations for each parameter.
     */
    let hasMatch = false
    let outputRules: Array<[Rules, number]> = []
    for (let [candidate, i] of evalCandidates) {
      if (isNode(candidate, 'Rules')) {
        hasMatch = true
        outputRules.push([candidate, i])
        continue
      }
      let rules = candidate.rules
      /**
       * During parsing, each ruleset should have been assigned
       * a scope by the tree context, so we can use that to
       * create a new scope.
       */
      let scope = new Scope(rules.scope)

      /** Now we need to add our parameters, if any */
      let params = candidate.params
      if (params) {
        for (let param of params.value) {
          if (isNode(param, ['VarDeclaration', 'Rest'])) {
            scope.setVar(param.name as string, param.value)
          }
        }
      }
      /** Now we can evaluate our guards, if any */
      let guard: Condition | Bool | undefined = candidate.guard
      let passes = true
      let incomingScope = thisContext.scope
      thisContext.scope = scope
      if (guard) {
        passes = false
        /** All nodes need context to be evaluated */
        thisContext.isDefault = !hasMatch
        guard = await guard.eval(thisContext)
        /** The guard condition passed */
        if (guard.value) {
          passes = true
        }
      }
      if (passes) {
        let newRules = rules.clone()
        newRules.scope = scope
        newRules = await newRules.eval(thisContext)
        outputRules.push([newRules, i])
      }
      thisContext.scope = incomingScope
    }
    /**
     * Now that we have output rules, we sort them by
     * their original order
     */
    let rulesArr = outputRules.sort((a, b) => a[1] - b[1]).map(r => r[0])
    /** Create a rules wrapper */
    let output = new Rules(rulesArr)
    /** Assign vars to new scope */
    rulesArr.forEach(r => {
      output.scope.merge(r.scope)
    })
    /** Now push all rules into the rules value */
    if (this instanceof Context) {
      return output
    } else {
      return output.toObject()
    }
  }

  return returnFunc
}
