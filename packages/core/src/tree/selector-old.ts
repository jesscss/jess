import { Node } from './node'
import type { ComplexSelector } from './selector-complex'
import { compare } from './util/compare'

/** Will be bound in ./util/compare.ts */
export interface Selector<T extends SelectorValue = SelectorValue> extends Node<T> {
  get value(): SelectorValue['value']
  set value(v: SelectorValue['value'])
  compare(other: Node): 0 | 1 | -1 | undefined
}

export type SelectorValue = {
  value: string | Node | Node[]
}

// export type KeyList = Array<string | SelectorList>
// export type Keys = string | SelectorList | KeyList

const { isArray } = Array

/** If it's an array, only the first element can optionally be a string array */
export type Keys = string | [(string | string[]), ...string[]]

export abstract class Selector<T extends SelectorValue = SelectorValue> extends Node<T> {
  protected _value: string
  protected _keys: Keys
  protected _keySet: Set<string>
  protected _paths: ComplexSelector[]

  extended: boolean = false

  get keys(): Keys {
    let keys = this._keys
    if (!keys) {
      Object.defineProperty(this, '_keys', { value: keys = this.valueOf() })
    }
    return keys
  }

  /**
   * All simple (normalized) selectors. The only keys
   * that should not be flattened are those at the start
   * of an :is() SelectorList
   */
  set keys(v: Keys) {
    this._keys = v
  }

  /** Normalized as Array */
  get keyList(): Exclude<Keys, string> {
    return isArray(this.keys) ? this.keys : [this.keys]
  }

  /** Always a Set, for normalization */
  get keySet(): Set<string> {
    let keySet = this._keySet
    if (!keySet) {
      let keys = this.keys
      Object.defineProperty(this, '_keySet', {
        value: keySet = new Set(isArray(keys) ? keys.flat() : [keys])
      })
    }
    return keySet
  }

  /** Normalization to lists of complex selectors for searching / matching */
  getPaths(): ComplexSelector[] {

  }

  normalize(): Selector {
    return this
  }

  /**
   * If found, will return the container? and the
   * preceding and following selectors?
   */
  find(sel: Selector): any {
    /**
     * Return the tree depth and position of start and end
     * Given:
     *   this = .one
     *   this.find(.one) => [[0, 0], [0, 0]]
     *
     * Given:
     *   this = .one.two
     *   this.find(.one) => [[0, 0], [0, 0]]
     *
     * Given:
     *   this = .one.two
     *   this.find(.two) => [[0, 1], [0, 1]]
     *
     * Given:
     *  this = .one.two
     *  this.find(.one.two) => [[0, 0], [0, 1]]
     *
     * Given:
     *  this = .one
     *  this.find(.three) => undefined
     *
     * Given:
     *  this = :is(.one, .two)
     *  this.find(.one) => [[0, 0, 0, 0], [0, 0, 0, 0]]
     *
     *
    */
  }

  asComplex(sel: Selector) {
    /** :is(a, b) */
  }

  /** The normalized value */
  valueOf(): string {
    let value = this._value
    if (!value) {
      value = this.toTrimmedString()
      Object.defineProperty(this, '_value', { value })
    }
    return value
  }

  compare(other: Node) {
    const thisValue = this.valueOf()
    const otherValue = other.valueOf()
    return compare(thisValue, otherValue)
  }
}