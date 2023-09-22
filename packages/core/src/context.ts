import { type Node } from './tree/node'
import type { Rule } from './tree/rule'
import type { Scope } from './scope'

export const enum MathMode {
  /**
   * @note - A Jess file always performs math for expressions,
   * but that's because expressions are only parsed as such
   * when wrapped with `#()`, whereas Less & SCSS try to
   * parse expressions in regular value sequences.
   */
  ALWAYS = 0,
  PARENS_DIVISION = 1,
  PARENS = 2
}

export const enum UnitMode {
  /** Less's default 1.x-5.x */
  LOOSE = 0,
  STRICT = 1
}

export interface ContextOptions {
  /** Hash classes for module output */
  module?: boolean
  /** Shit what does this mean */
  dynamic?: boolean
  collapseNesting?: boolean
  /**
   * Hoists variable declarations, so they can be
   * evaluated per scope. Less sets this to true.
   */
  hoistVariables?: boolean

  mathMode?: MathMode
  unitMode?: UnitMode
}

const idChars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'.split('')

export const generateId = (length = 8) => {
  let str = ''
  for (let i = 0; i < length; i++) {
    str += idChars[Math.floor(Math.random() * idChars.length)]
  }
  return str
}

/**
 * @todo
 * Every file should get a new context, but should inherit
 * from an existing context?
 *
 * @note
 * Most of context represents "state" while evaluating.
 */
export class Context {
  readonly opts: ContextOptions
  state: ContextOptions

  /** Rulesets will assign scope when evaluating */
  scope: Scope

  /**
   * The file (eval) context should have the same ID at compile-time
   * as run-time, so this ID will be set in `toModule()` output
   */
  id = generateId()
  varCounter: number = 0

  /** @todo - change to Map() */
  classMap: Record<string, string> = Object.create(null)

  /**
   * The rule frames. This is used to resolve
   * '&' when we need to.
   */
  frames: Rule[] = []

  /** Keeps track of the indention level */
  indent = 0

  /**
   * Keys of @let variables --
   * We need this b/c we need to generate code
   * for over-riding in the exported function.
   */
  exports = new Set<string>()

  depth = 0
  rootRules: Node[] = []

  /** currently generating a runtime module or not */
  isRuntime: boolean

  /** In a custom declaration's value */
  inCustom: boolean

  /** In a selector */
  inSelector: boolean

  /** A flag set by expressions */
  canOperate: boolean

  constructor(opts: ContextOptions = {}) {
    opts = {
      /** Default mode for Less & SCSS */
      mathMode: MathMode.PARENS_DIVISION,
      unitMode: UnitMode.STRICT,
      ...opts
    }
    this.state = opts
    this.opts = opts
  }

  get pre() {
    return Array(this.indent + 1).join('  ')
  }

  /** Hash a CSS class name or not depending on the `module` setting */
  hashClass(name: string) {
    /** Remove dot for mapping */
    name = name.slice(1)
    let lookup = this.classMap[name]
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

  shouldOperate(op: '+' | '-' | '*' | '/') {
    const mathMode = this.opts.mathMode
    /** Parens for Less/SCSS will set `canOperate` to true */
    if (mathMode === MathMode.ALWAYS || this.canOperate) {
      return true
    }
    if (mathMode === MathMode.PARENS_DIVISION && op === '/') {
      return false
    }
    if (mathMode === MathMode.PARENS) {
      return false
    }
    return true
  }
}