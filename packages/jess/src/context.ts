import type { Node } from './tree'
import config from './config'

export type ContextOptions = {
  module?: boolean
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

  rootLevel: number
  rootRules: Node[]

  /** In a custom declaration's value */
  inCustom: boolean

  /** In a selector */
  inSelector: boolean

  constructor(opts: ContextOptions = {}) {
    this.originalOpts = opts
    this.opts = {
      ...opts,
      ...config.options,
    }
    this.id = generateId()
    this.frames = []
    this.exports = new Set()
    this.indent = 0
    this.rootLevel = 0
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
}