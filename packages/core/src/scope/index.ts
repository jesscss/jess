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
export type ScopeOptions = {
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
}

/**
 * We use this to store meta-information
 * about keys / values. For example, values
 * from imports are protected.
 */
export class ScopeEntry {
  options: ScopeOptions
  key: string
  value: unknown

  constructor(key: string, value?: unknown, opts?: ScopeOptions) {
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
  _parentScope: Scope | undefined

  /**
   * Keys are normalized to camelCase, therefore we should
   * warn when a key is normalized differently
   */
  static entryKeys: Map<string, string>

  constructor(parentScope?: Scope) {
    this._parentScope = parentScope
    /**
     * Assign to parent entries at first.
     * This allows us to lazily extend the prototype chain.
     *
     * If no keys are ever assigned, we can just lookup
     * keys from the parent scope.
     */
    if (parentScope) {
      this._vars = parentScope._vars
      this._props = parentScope._props
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
      if (currentEntries === this._parentScope?.[key]) {
        const entries = Object.create(this._parentScope[key])
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
      /** First entry is most recent */
      props[key] = Array.isArray(entry) ? [...entry, value] : [entry, value]
    } else {
      props[key] = value
    }
  }

  /** @todo - merge into lists / sequences */
  getProp(key: string) {
    return this._props[key]
  }

  /**
   * This will store a scoped identifier
   * that is compatible with JS.
   */
  setVar(key: string, value: unknown, opts?: ScopeOptions) {
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

    const { vars } = this
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
      if (entry.options.preserve) {
        /** First entry is most recent */
        entry.value = Array.isArray(entry.value) ? [value, ...entry.value] : [value, entry.value]
        return
      }
      entry.value = value
    } else {
      /** Shadow the variable within the local scope */
      vars[normalKey] = new ScopeEntry(normalKey, value, opts)
    }
  }

  /**
   * We can pass in a filter to narrow the
   * entries.
   */
  getVar(key: string, options: {
    filter?: (entry: ScopeEntry | undefined) => { value: unknown, done: boolean }
  } = {}): any {
    key = this.normalizeKey(key)
    const {
      filter = (entry: ScopeEntry | undefined) => {
        if (entry) {
          if (Array.isArray(entry.value)) {
            return {
              value: entry.value[0],
              done: true
            }
          } else {
            return {
              value: entry.value,
              done: true
            }
          }
        }
        return { value: undefined, done: true }
      }
    } = options
    /**
     * When getting, use the private variable,
     * so we don't extend the prototype chain.
     */
    let current: ScopeEntryMap | undefined = this._vars
    /**
     * We use this instead of undefined,
     * in case the prototype chain has undefined values?
     *
     * May be unnecessary?
     */
    const unset = Symbol('unset')
    let value: any = unset
    while (current) {
      const result = filter(current[key])
      const resultValue = result.value
      if (value === unset) {
        value = resultValue
      } else {
        value = [
          ...(Array.isArray(value) ? value : [value]),
          ...(Array.isArray(resultValue) ? resultValue : [resultValue])
        ]
      }
      if (result.done) {
        return value
      }
      /** Traverse up the prototype chain */
      current = current.prototype
    }
  }
}

Scope.entryKeys = new Map()
