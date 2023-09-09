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
  throwIfDefined?: boolean
  throwIfUndefined?: boolean
  /** Variable declarations replace earlier variable declarations */
  replace?: boolean
}

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
  _entries: ScopeEntryMap
  _parentScope: Scope | undefined

  /**
   * Keys are normalized to camelCase, therefore we should
   * warn when a key is normalized differently
   */
  static entryKeys: Map<string, string>

  constructor(parentScope?: Scope) {
    this._parentScope = parentScope
    if (parentScope) {
      this._entries = parentScope._entries
    }
  }

  /** Normalizes keys as valid JavaScript identifiers. */
  normalizeKey(key: string) {
    let normalKey = Scope.entryKeys.get(key)
    if (normalKey) {
      if (normalKey !== key) {
        logger.warn(`${key} was previously normalized from ${normalKey}, which could lead to unexpected behaviors.`)
      }
    } else {
      normalKey = key
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
    }
    return normalKey
  }

  /**
   * Lazily create prototype chains
   * for improved performance.
   */
  get entries(): ScopeEntryMap {
    const currentEntries = this._entries
    if (currentEntries) {
      if (currentEntries === this._parentScope?._entries) {
        const entries = Object.create(this._parentScope._entries)
        this._entries = entries
        return entries
      }
      return currentEntries
    } else {
      const entries = Object.create(null)
      this._entries = entries
      return entries
    }
  }

  set(key: string, value: unknown, opts?: ScopeOptions) {
    if (key.startsWith('$')) {
      throw new SyntaxError(`"${key}" cannot start with "$"`)
    }
    const normalKey = this.normalizeKey(key)
    Scope.entryKeys.set(normalKey, key)
    if (RESERVED.includes(normalKey)) {
      throw new SyntaxError(`"${normalKey}" is a reserved identifier`)
    }
    const { entries } = this
    const entry = entries[normalKey]
    if (normalKey in entries) {
      /**
       * These sort of do similar things, they just throw
       * different errors.
       */
      if (entry?.options.throwIfDefined ?? opts?.throwIfDefined) {
        throw new SyntaxError(`"${key}" is already defined`)
      } else if (entry?.options.protected ?? opts?.protected) {
        throw new SyntaxError(`Assignment to protected variable "${key}"`)
      }
    } else if (opts?.throwIfUndefined) {
      throw new ReferenceError(`"${key}" is not defined`)
    }
    if (Object.prototype.hasOwnProperty.call(entries, normalKey)) {
      /** Modify the local entry */
      const entry = entries[key]!
      if (entry.options.replace) {
        entry.value = value
        return
      }
      /** First entry is most recent */
      entry.value = Array.isArray(entry.value) ? [value, ...entry.value] : [value, entry.value]
    } else {
      entries[normalKey] = new ScopeEntry(normalKey, value, opts)
    }
  }

  /**
   * We can pass in a filter to narrow the
   * entries.
   */
  get(key: string, options: {
    filter?: (entry: ScopeEntry | undefined) => { value: any, done: boolean }
  } = {}): any {
    key = this.normalizeKey(key)
    const {
      filter = entry => ({ value: entry, done: true })
    } = options
    let current: ScopeEntryMap | undefined = this._entries
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
      current = current.prototype
    }
  }
}

Scope.entryKeys = new Map()
