import { Node } from './tree/node'
import { Nil } from './tree/nil'
import { List } from './tree/list'
import { Dimension } from './tree/dimension'
import { Anonymous } from './tree/anonymous'
import isPlainObject from 'lodash/isPlainObject'

export type ContextOptions = {
  module?: boolean
  dynamic?: boolean
  [k: string]: string | number | boolean
}

const idChars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'.split('')

export const generateId = (length = 8) => {
  let str = ''
  for (let i = 0; i < length; i++) {
    str += idChars[Math.floor(Math.random() * idChars.length)]
  }
  return str
}

export class Context {
  opts: ContextOptions
  originalOpts: ContextOptions
  /**
   * The file (eval) context should have the same ID at compile-time
   * as run-time, so this ID will be set in `toModule()` output
   */
  id: string
  varCounter: number = 0
  classMap: {
    [k: string]: string
  }

  frames: Node[]

  /** Keeps track of the indention level */
  indent: number

  /**
   * Keys of @let variables --
   * We need this b/c we need to generate code
   * for over-riding in the exported function.
   */
  exports: Set<string>

  depth: number
  rootRules: Node[]

  /** currently generating a runtime module or not */
  isRuntime: boolean

  /** In a custom declaration's value */
  inCustom: boolean

  /** In a selector */
  inSelector: boolean

  constructor(opts: ContextOptions = {}) {
    this.originalOpts = opts
    this.opts = opts
    this.id = generateId()
    this.frames = []
    this.exports = new Set()
    this.indent = 0
    this.depth = 0
    this.classMap = Object.create(null)
    this.rootRules = []
  }

  get pre() {
    return Array(this.indent + 1).join('  ')
  }

  /** Hash a CSS class name or not depending on the `module` setting */
  hashClass(name: string) {
    /** Remove dot for mapping */
    name = name.slice(1)
    const lookup = this.classMap[name]
    if (lookup) {
      return `.${lookup}`
    }
    let mapVal: string
    if (this.opts.module) {
      mapVal = `${name}_${this.id}`
    } else {
      mapVal = name
    }
    this.classMap[name] = mapVal
    return `.${mapVal}`
  }

  getVar() {
    return `--v${this.id}-${this.varCounter++}`
  }

  /**
   * Casts a primitive value to a Jess node
   * (if not already). This is for CSS output.
   * 
   * @example
   * cast(area(5))
   */
  cast(value: any): Node {
    if (value === undefined || value === null) {
      return new Nil
    }
    if (value instanceof Node) {
      return value
    }
    if (isPlainObject(value)) {
      if (Object.prototype.hasOwnProperty.call(value, '$root')) {
        return value.$root
      }
      return new Anonymous('[object]')
    }
    if (Array.isArray(value)) {
      return new List(value)
    }
    if (value.constructor === Number) {
      return new Dimension(<number>value)
    }
    return new Anonymous(value.toString())
  }
}