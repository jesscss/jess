import { logger } from '../logger'
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

/**
 * We use this to store meta-information
 * about keys / values. For example, values
 * from imports are protected.
 */
export class ScopeEntry {
  options: ScopeEntryOptions
  key: string
  value: unknown

  constructor(key: string, value?: unknown, opts?: ScopeEntryOptions) {
    this.key = key
    this.value = value
    this.options = opts ?? {}
  }
}

export type ScopeEntryMap = Record<string, ScopeEntry | undefined> & {
  prototype: ScopeEntryMap | undefined
}

export type PropMap = Record<string, unknown | unknown[]> & {
  prototype: PropMap | undefined
}

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

type ScopeOptions = {
  /**
   * Less leaks variable declarations from a child
   * scope into the current scope.
   */
  leakVariablesIntoScope?: boolean
}

type FilterResult = {
  value: unknown
  done: boolean
}

type GetterOptions = {
  /** Filter is a function or value to compare when looking up values */
  filter?: (value: unknown, foundValues?: any[]) => FilterResult

  /** Only return local values, not all scope values */
  local?: boolean
  /**
   * Not sure this is a good option, as it maybe makes more
   * sense to throw an error if not found? Depends on user expectations.
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
  /**
   * Includes vars but also mixin declarations,
   * imported functions, JS identifiers, etc
   */
  _vars: ScopeEntryMap
  /**
   * @note - For Jess, we could have stored all
   * mixins in the vars map, but other languages
   * need more dis-ambiguation.
   */
  _mixins: ScopeEntryMap
  _props: PropMap
  _parent?: Scope

  options: ScopeOptions

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

  constructor(parent?: Scope, options?: ScopeOptions) {
    this.options = options ?? {}
    this._parent = parent
    /**
     * Assign to parent entries at first.
     * This allows us to lazily extend the prototype chain.
     *
     * If no keys are ever assigned, we can just lookup
     * keys from the parent scope.
     */
    if (parent) {
      this._vars = parent._vars
      this._props = parent._props
      this._mixins = parent._mixins
    } else {
      this._vars = Object.create(null)
      this._props = Object.create(null)
      this._mixins = Object.create(null)
    }
  }

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
      .replace(/(^_)|(?:[#-_])(.)/g, (_, p1 = '', p2 = '') => `${p1}${p2.toUpperCase()}`)

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
      throw new SyntaxError(`"${key}" is not a valid name, as it is not exportable`)
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
  getEntries(key: '_vars' | '_mixins'): ScopeEntryMap
  getEntries(key: '_props'): PropMap
  getEntries(key: '_vars' | '_props' | '_mixins'): ScopeEntryMap | PropMap {
    let currentEntries = this[key]
    if (currentEntries === this._parent?.[key]) {
      let entries = Object.create(this._parent[key])
      this[key] = entries
      return entries
    }
    return currentEntries
  }

  /** Merges a scope (usually child) into this scope object */
  merge(scope: Scope) {
    let props = scope._props
    let keys = Object.getOwnPropertyNames(props)
    let keyLength = keys.length
    for (let i = 0; i < keyLength; i++) {
      let key = keys[i]
      this.setProp(key, props[key])
    }
    if (this.options?.leakVariablesIntoScope) {
      let leakVariables = (lookupKey: '_vars' | '_mixins') => {
        let importedVars = scope[lookupKey]
        let localVars = this[lookupKey]
        let setter = lookupKey === '_vars' ? this.setVar : this.setMixin
        let keys = Object.getOwnPropertyNames(importedVars)
        let keyLength = keys.length
        for (let i = 0; i < keyLength; i++) {
          let key = keys[i]
          /** Only leak vars if they aren't defined */
          if (key in localVars && localVars[key]?.options.preserve !== true) {
            continue
          }
          let entry = importedVars[key]!
          if (!entry.options.private) {
            setter.call(this, key, entry)
          }
        }
      }
      leakVariables('_vars')
      leakVariables('_mixins')
    }
  }

  get mixins(): ScopeEntryMap {
    return this.getEntries('_mixins')
  }

  get vars(): ScopeEntryMap {
    return this.getEntries('_vars')
  }

  get props(): PropMap {
    return this.getEntries('_props')
  }

  setProp(key: string, value: unknown) {
    let { props } = this
    if (Object.prototype.hasOwnProperty.call(props, key)) {
      /** Modify the local entry */
      let entry = props[key]!

      props[key] =
        Array.isArray(entry)
          ? Array.isArray(value)
            ? [...entry, ...value]
            : [...entry, value]
          : Array.isArray(value)
            ? [entry, ...value]
            : [entry, value]
    } else {
      props[key] = value
    }
  }

  /**
   * This will store a scoped identifier
   * that is compatible with JS.
   */
  private _setVarOrMixin(lookupKey: 'vars' | 'mixins', key: string, value: unknown, opts?: ScopeEntryOptions) {
    let vars = this[lookupKey]
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
      if (RESERVED.includes(normalKey)) {
        throw new SyntaxError(`"${normalKey}" is a reserved identifier`)
      }
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
        throw new SyntaxError(`Assignment to protected variable "${key}"`)
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

      /**
       * Unlike properties, vars are stored with
       * most recent first.
       */
      entry.value = Array.isArray(entry.value) ? [value, ...entry.value] : [value, entry.value]
    } else {
      /** Shadow the variable within the local scope */
      vars[normalKey] = new ScopeEntry(normalKey, value, opts)
    }
  }

  setVar(key: string, value: unknown, opts?: ScopeEntryOptions) {
    this._setVarOrMixin('vars', key, value, opts)
  }

  setMixin(key: string, value: unknown, opts?: ScopeEntryOptions) {
    this._setVarOrMixin('mixins', key, value, opts)
  }

  getVar(key: string, options?: GetterOptions) {
    return this._getBase('_vars', key, options)
  }

  getMixin(key: string, options?: GetterOptions) {
    return this._getBase('_mixins', key, options)
  }

  /** @todo - merge into lists / sequences */
  getProp(key: string, options: GetterOptions = {}) {
    return this._getBase('_props', key, {
      filter(value: unknown) {
        return { value, done: false }
      },
      ...options
    })
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
  private _getBase(collection: '_vars' | '_props' | '_mixins', baseKey: string, options: GetterOptions = {}): any {
    let NONE = Scope.NONE
    let key = this.normalizeKey(baseKey)
    let {
      /** By default, return the first value */
      filter = (value: unknown) => ({ value, done: true })
    } = options
    /**
     * When getting, use the private variable,
     * so we don't extend the prototype chain.
     */
    let current: ScopeEntryMap | PropMap | undefined = this[collection]
    let results: any[] = []

    while (current) {
      let entry = (options.local && !Object.prototype.hasOwnProperty.call(current, key)) ? undefined : current[key]
      if (!entry) {
        /** Needed? */
        if (options.suppressUndefinedError) {
          return undefined
        }
        throw new ReferenceError(`"${baseKey}" is not defined`)
      }
      let entryValue: unknown = collection === '_vars' ? (entry as ScopeEntryMap).value : entry
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
      current = current.prototype
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
