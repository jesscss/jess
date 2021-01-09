import { Node } from '.'

/**
 * A space-separated expression
 */
export class Expression extends Node {
  value: Node[]
  
  toString() {
    return this.value.join(' ')
  }
}

export const expr =
  (...args: ConstructorParameters<typeof Expression>) => new Expression(...args)