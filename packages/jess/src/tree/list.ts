import { Node } from '.'

/**
 * A list of expressions
 * 
 * i.e. one, two, three
 * or .sel, #id.class, [attr]
 */
export class List extends Node {
  value: Node[]
  
  toString() {
    return this.value.join(', ')
  }
}

export const list =
  (...args: ConstructorParameters<typeof List>) => new List(...args)