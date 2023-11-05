import { type Node } from './tree/node'
import type { Ruleset } from './tree/ruleset'
import { Scope } from './scope'
import type { Declaration, Root } from './tree'
import { type Operator } from './tree/util/calculate'
import type { PluginObject } from './plugin'
import * as path from 'node:path'

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

const { isArray } = Array

export interface ContextOptions {
  /** Hash classes for module output */
  module?: boolean
  /**
   * From docs:
   * "Changes compilation mode so dynamic content
   * is output as CSS variables, and changes
   * the runtime module to generate CSS patches."
   *
   * @todo - Change this behavior to "live expressions"
   */
  dynamic?: boolean
  collapseNesting?: boolean

  mathMode?: MathMode
  unitMode?: UnitMode

  /** Directories to search to resolve files */
  paths?: string[]
}

export interface TreeContextOptions extends ContextOptions {
  /**
   * Hoists variable declarations, so they can be
   * evaluated per scope. Less sets this to true.
   */
  hoistDeclarations?: boolean

  /** In Less 1.x-5.x, Less sets this to true */
  leakVariablesIntoScope?: boolean

  inlineJavaScript?: boolean

  /**
   * For instances where a new tree needs to inherit from scope
   * (like Less / SCSS `@import` rule)
   */
  scope?: Scope
}

const idChars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'.split('')

export const generateId = (length = 8) => {
  let str = ''
  let idCharsLength = idChars.length
  for (let i = 0; i < length; i++) {
    str += idChars[Math.floor(Math.random() * idCharsLength)]!
  }
  return str
}

/**
 * Tree context is attached to each node
 * during the parsing phase / AST creation.
 *
 * Each file (and hence, tree) will get a new tree
 * context. For the most part, it is passed around
 * as an object reference, but during AST creation,
 * the scope property will be modified (and later
 * restored when the file is finished with AST
 * creation) so that rulesets can inherit scope
 * based on their tree postion.
 *
 * It's used primarily to attach scope to rulesets,
 * since rules have context / scope according
 * to their position in the tree.
 *
 * Additionally, it sets options that may be
 * unique to the tree, such as the math mode.
 */
export class TreeContext implements TreeContextOptions {
  hoistDeclarations?: boolean
  leakVariablesIntoScope?: boolean
  mathMode?: MathMode
  unitMode?: UnitMode

  file?: {
    name: string
    path: string
    /** Contents of the file, separated into lines */
    contents: string[]
  }

  /** Rules will inherit scope when created */
  scope: Scope

  /**
   * The plugin that created this tree. It will have first dibs
   * to resolve any imports.
   */
  plugin?: PluginObject

  constructor(opts: TreeContextOptions = {}) {
    this.hoistDeclarations = opts.hoistDeclarations ?? false
    this.leakVariablesIntoScope = opts.leakVariablesIntoScope ?? false
    this.mathMode = opts.mathMode ?? MathMode.PARENS_DIVISION
    this.unitMode = opts.unitMode ?? UnitMode.STRICT
    this.scope = opts.scope ?? new Scope()
  }
}
let code1 = 0
let code2 = 0

/**
 * This is the context object used for evaluation.
 *
 * @note
 * Most of context represents "state" while evaluating.
 * There should only ever be one Context object per
 */
export class Context {
  /**
   * Selector elements (simple selectors and combinators)
   * mapped to incremented char codes.
   *
   * When extending, we can use this to search for
   * matches within a selector sequence, and then
   * map the match position (and range) back to the
   * selector sequence.
   */
  static selectorKeys = new Map<string, string>()
  static keysFromSelector = new Map<string, string>()

  readonly plugins: PluginObject[]
  readonly opts: ContextOptions

  currentTree: TreeContext

  /**
   * When getting vars, the current declaration is ommitted
   * to prevent recursion errors
   */
  declarationScope: Declaration | undefined

  /**
   * This is set when entering rulesets so that child nodes
   * can use this to lookup values.
   */
  scope: Scope
  /**
   * The file (eval) context should have the same ID at compile-time
   * as run-time, so this ID will be set in `toModule()` output
   */
  id = generateId()
  varCounter: number = 0

  /** @todo - change to Map() */
  classMap = new Map<string, string>()

  /**
   * The ruleset (qualified rule) frames. This is used to resolve
   * '&' when we need to.
   */
  frames: Ruleset[] = []

  /** Keeps track of the indention level */
  indent = 0

  /**
   * Keys of @let variables --
   * We need this b/c we need to generate code
   * for over-riding in the exported function.
   */
  exports = new Set<string>()

  /** @todo - is this still used? */
  depth = 0

  rootRules: Node[] = []

  /**
   * currently generating a runtime module or not
   * @todo - remove in favor of ToModuleVisitor?
   */
  // isRuntime: boolean

  /**
   * In a custom declaration's value. All nodes should
   * be preserved as-is and not evaluated, except for
   * interpolated expressions.
  */
  inCustom: boolean

  /**
   * In a selector
   * @todo - remove?
  */
  // inSelector: boolean

  /** A flag set by expressions */
  canOperate: boolean

  /** A flag set when evaluating conditions */
  isDefault: boolean

  constructor(opts: ContextOptions = {}, plugins?: PluginObject[]) {
    this.opts = opts
    this.plugins = plugins ?? []
  }

  get pre() {
    return Array(this.indent + 1).join('  ')
  }

  async getTree(filePath: string, initialDirectory?: string, options?: Record<string, any>) {
    initialDirectory ??= path.dirname(filePath)
    const paths = this.opts.paths ?? []
    options ??= {}
    options = { ...this.opts, ...options }

    const plugins = this.plugins
    const pluginLength = plugins.length
    let fullPath: string | undefined
    let resolvedTree: Root | false | undefined
    const triedPaths: string[] = []

    let rootPlugin = this.currentTree?.plugin

    /** If we have a root plugin, try it first */
    if (rootPlugin?.fileManager) {
      const result = rootPlugin.fileManager.getPath(filePath, initialDirectory, paths, options)
      if (isArray(result)) {
        triedPaths.push(...result)
      } else {
        fullPath = result
      }
    }

    /** Iterate in reverse, starting with last added plugin */
    for (let i = pluginLength - 1; i >= 0; i--) {
      const plugin = plugins[i]!
      if (plugin === rootPlugin) {
        continue
      }
      if (!plugin.fileManager) {
        continue
      }
      const result = plugin.fileManager.getPath(filePath, initialDirectory, paths, options)
      if (isArray(result)) {
        triedPaths.push(...result)
      } else {
        fullPath = result
        break
      }
    }
    if (!fullPath) {
      throw new Error('File not found')
    }

    /** If we have a root plugin, try it first */
    if (rootPlugin?.fileManager) {
      const result = await rootPlugin.fileManager.getTree(fullPath, options)
      if (result) {
        return result
      }
    }

    for (let i = pluginLength - 1; i >= 0; i--) {
      const plugin = plugins[i]!
      if (plugin === rootPlugin) {
        continue
      }
      if (!plugin.fileManager) {
        continue
      }
      const tree = await plugin.fileManager.getTree(fullPath, options)
      if (tree) {
        resolvedTree = tree
        break
      }
    }
    if (!resolvedTree) {
      throw new Error(`File "${path.basename(filePath)}" not supported`)
    }
    return resolvedTree
  }

  /**
   * Hash a CSS class name or not depending on the `module` setting
   * @todo - module files should have different contexts, therefore different
   * hash maps.
   */
  hashClass(name: string) {
    /** Remove dot for mapping */
    name = name.slice(1)
    let lookup = this.classMap.get(name)
    if (lookup) {
      return `.${lookup}`
    }
    let mapVal: string
    if (this.opts.module) {
      mapVal = `${name}_${this.id}`
    } else {
      mapVal = name
    }
    this.classMap.set(name, mapVal)
    return `.${mapVal}`
  }

  /**
   * This is only done for simple selectors and combinators
   * to create a normalized key for searching / extends.
   */
  registerSelectorElement(el: string) {
    let key = Context.selectorKeys.get(el)
    if (key) {
      return key
    }
    key = String.fromCharCode(code1, code2++)
    if (code2 > 65535) {
      code2 = 0
      code1++
    }
    Context.selectorKeys.set(key, el)
    Context.keysFromSelector.set(el, key)
    return key
  }

  getVar() {
    return `--v${this.id}-${this.varCounter++}`
  }

  shouldOperate(op: Operator) {
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