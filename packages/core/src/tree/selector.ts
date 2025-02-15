import { Node } from './node'

/** This represents anything that is valid in a selector */

export abstract class Selector<T extends any = any> extends Node<T> {
  isSelector = true

  _valueOf: string | undefined
  /**
   * For selectors, this is a normalized value, not just
   * a straight stringification like toTrimmedString 
   */
  override valueOf(): string {
    return ''
  }

  /**
   * A set of all simplified (valueOf) selectors,
   * for easy lookup to see if the selector is extendable
   * by the key sets in the extend scope.
   */
  _keySet: Set<string> | undefined
  abstract keySet: Set<string>
}