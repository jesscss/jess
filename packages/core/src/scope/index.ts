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
  parent?: Scope
  /**
   * Less leaks variable declarations into the parent
   * if it's undefined.
   */
  leakIntoParent?: boolean
}

type FilterResult = {
  value: unknown
  done: boolean
}

type GetterOptions = {
  /** Filter is a function or value to compare when looking up values */
  filter?: (value: unknown, foundValues?: any[]) => FilterResult
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
  _props: PropMap

  options: ScopeOptions | undefined

  /**
   * Keys are normalized to camelCase, therefore we should
   * warn when a key is normalized differently
   */
  static entryKeys: Map<string, string>

  constructor(options?: ScopeOptions) {
    this.options = options
    /**
     * Assign to parent entries at first.
     * This allows us to lazily extend the prototype chain.
     *
     * If no keys are ever assigned, we can just lookup
     * keys from the parent scope.
     */
    if (options?.parent) {
      this._vars = options.parent._vars
      this._props = options.parent._props
    }
  }

  /** Normalizes keys as valid JavaScript identifiers. */
  normalizeKey(key: string) {
    const normalKey = key
    /** Replace initial dash with underscore */
      .replace(/^-/, '_')
    /** Remove initial . or # (used by Less) */
      .replace(/^[.#]/, '')
    /** Convert dash-case to camelCase */
      .replace(/(^_)|(?:[-_])(.)/g, (_, p1 = '', p2 = '') => `${p1}${p2.toUpperCase()}`)

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

    const lookupKey = Scope.entryKeys.get(normalKey)
    if (lookupKey) {
      if (lookupKey !== key) {
        logger.warn(`${key} was previously normalized from ${lookupKey}, which could lead to unexpected behaviors.`)
      }
    }
    return normalKey
  }

  /**
   * Lazily create prototype chains
   * for improved performance.
   */
  getEntries(key: '_vars'): ScopeEntryMap
  getEntries(key: '_props'): PropMap
  getEntries(key: '_vars' | '_props'): ScopeEntryMap | PropMap {
    const currentEntries = this[key]
    if (currentEntries) {
      if (currentEntries === this.options?.parent?.[key]) {
        const entries = Object.create(this.options.parent[key])
        this[key] = entries
        return entries
      }
      return currentEntries
    } else {
      const entries = Object.create(null)
      this[key] = entries
      return entries
    }
  }

  assign(scope: Scope) {
    const props = scope._props
    const keys = Object.getOwnPropertyNames(props)
    const keyLength = keys.length
    for (let i = 0; i < keyLength; i++) {
      const key = keys[i]
      this.setProp(key, props[key])
    }
    if (this.options?.leakIntoParent) {
      const vars = scope._vars
      const keys = Object.getOwnPropertyNames(vars)
      const keyLength = keys.length
      for (let i = 0; i < keyLength; i++) {
        const key = keys[i]
        /** Only leak vars if they aren't defined */
        if (key in this._vars && this._vars[key]?.options.preserve !== true) {
          continue
        }
        const entry = vars[key]!
        if (!entry.options.private) {
          this.setVar(key, entry)
        }
      }
    }
  }

  get vars(): ScopeEntryMap {
    return this.getEntries('_vars')
  }

  get props(): PropMap {
    return this.getEntries('_props')
  }

  setProp(key: string, value: unknown) {
    const { props } = this
    if (Object.prototype.hasOwnProperty.call(props, key)) {
      /** Modify the local entry */
      const entry = props[key]!

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
  setVar(key: string, value: unknown, opts?: ScopeEntryOptions) {
    const { vars } = this
    if (value instanceof ScopeEntry) {
      vars[key] = value
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
      const entry = vars[normalKey]!
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
      const entry = vars[normalKey]!

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

  getVar(key: string, options?: GetterOptions) {
    return this._getBase('_vars', key, options)
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

  /**
   * We can pass in a filter to narrow the
   * entries.
   */
  private _getBase(collection: '_vars' | '_props', baseKey: string, options: GetterOptions = {}): any {
    const key = this.normalizeKey(baseKey)
    const {
      /** By default, return the first value */
      filter = (value: unknown) => ({ value, done: true })
    } = options
    /**
     * When getting, use the private variable,
     * so we don't extend the prototype chain.
     */
    let current: ScopeEntryMap | PropMap | undefined = this[collection]
    const results: any[] = []

    while (current) {
      const entry = current[key]
      if (!entry) {
        if (options.suppressUndefinedError) {
          return undefined
        }
        throw new ReferenceError(`"${baseKey}" is not defined`)
      }
      const entryValue: unknown = collection === '_vars' ? (entry as ScopeEntryMap).value : entry
      let lastResult: FilterResult
      if (Array.isArray(entryValue)) {
        for (let i = 0; i < entryValue.length; i++) {
          const val = filter(entryValue[i], results)
          if (val.value !== undefined) {
            results.push(val.value)
          }
          lastResult = val
          if (val.done) {
            break
          }
        }
      } else {
        const val = filter(entryValue, results)
        lastResult = val
        if (val.value !== undefined) {
          results.push(val.value)
        }
      }

      if (lastResult!.done) {
        return results.length
          ? results.length === 1
            ? results[0]
            : results
          : undefined
      }
      /** Traverse up the prototype chain */
      current = current.prototype
    }
    const returnResult = results.length
      ? results.length === 1
        ? results[0]
        : results
      : undefined
    if (returnResult === undefined && !options.suppressUndefinedError) {
      throw new ReferenceError(`"${baseKey}" is not defined`)
    }
    return returnResult
  }
}

Scope.entryKeys = new Map()
