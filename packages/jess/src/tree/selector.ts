import { Node, Element } from '.'

/**
 * @example
 * #id > .class.class
 * 
 * Stored as:
 * [Element, '>', Element, Element]
 */
export class Selector extends Node {
  value: (Node | string)[]

  toString() {
    let out = ''
    this.value.forEach(node => {
      if (node.constructor === String) {
        out += node === ' ' ? node : ` ${node} `
      } else {
        out += node.toString()
      }
    })
    return out
  }
}

export const sel =
  (...args: ConstructorParameters<typeof Selector>) => new Selector(...args)