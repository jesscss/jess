import { Node } from '.'

export class Element extends Node {
  value: string
  
  /** Very simple string matching */
  get isAttr() {
    return /^\[/.test(this.value)
  }
  get isClass() {
    return /^\./.test(this.value)
  }
  get isId() {
    return /^#/.test(this.value)
  }
  get isPseudo() {
    return /^:/.test(this.value)
  }
  get isIdent() {
    return /^[a-z]/.test(this.value)
  }
}

export const el =
  (...args: ConstructorParameters<typeof Element>) => new Element(...args)