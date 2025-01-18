import { type Node } from './node'

/** This represents anything that is valid in a selector */
export interface Selector extends Node {
  isSelector: true

  _valueOf: string | undefined
  valueOf(): string

  find(needle: Selector): Selector[] | undefined

  /**
   * A set of all simplified (valueOf) selectors,
   * for easy lookup to see if the selector is extendable
   * by the key sets in the extend scope.
   */
  keySet: Set<string>
}