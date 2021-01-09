import { Expression } from '.'
import type { Node } from './node'

/**
 * A space-separated expression
 */
export class Spaced extends Expression {
  value: Node[]
  
  toString() {
    return this.value.join(' ')
  }
}

export const spaced =
  (...args: ConstructorParameters<typeof Spaced>) =>
    new Spaced(...args)