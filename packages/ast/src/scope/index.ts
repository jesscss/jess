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

export type ScopeObj = {
  _entries: Record<string, ScopeEntry>
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
  _entries: Record<string, ScopeEntry | undefined>
  _parentScope: ScopeObj | undefined

  constructor(parentScope?: ScopeObj) {
    this._parentScope = parentScope
    if (parentScope) {
      this._entries = parentScope._entries
    }
  }

  /**
   * Lazily create prototype chains
   * for improved performance.
   */
  get entries(): Record<string, ScopeEntry | undefined> {
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
    if (RESERVED.includes(key)) {
      throw new SyntaxError(`"${key}" is a reserved identifier`)
    }
    const { entries } = this
    const entry = entries[key]
    if (key in entries) {
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
    if (Object.prototype.hasOwnProperty.call(entries, key)) {
      /** Modify the local entry */
      const entry = entries[key]!
      if (entry.options.replace) {
        entry.value = value
        return
      }
      entry.value = Array.isArray(entry.value) ? [...entry.value, value] : [entry.value, value]
    } else {
      entries[key] = new ScopeEntry(key, value, opts)
    }
  }
}
