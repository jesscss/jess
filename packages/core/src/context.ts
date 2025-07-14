import type {
  AtRule,
  Declaration,
  Root,
  Node,
  Ruleset,
  Rules
} from './tree';
import { type Operator } from './tree/util/calculate';
import type { PluginObject } from './plugin';
import * as path from 'node:path';

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

const { isArray } = Array;

export interface ContextOptions {
  /** Hash classes for module output */
  module?: boolean;
  /**
   * From docs:
   * "Changes compilation mode so dynamic content
   * is output as CSS variables, and changes
   * the runtime module to generate CSS patches."
   *
   * @todo - Change this behavior to "live expressions"
   * i.e. change compilation to always be static, but
   * generate a separate module for calculated CSS variables.
   */
  dynamic?: boolean;
  collapseNesting?: boolean;

  mathMode?: MathMode;
  unitMode?: UnitMode;

  /** Directories to search to resolve files */
  paths?: string[];
}

export interface TreeContextOptions extends ContextOptions {
  /**
   * Hoists variable declarations, so they can be
   * evaluated per scope. Less sets this to true.
   */
  // hoistDeclarations?: boolean

  /** In Less 1.x-5.x, Less sets this to true */
  // leakVariablesIntoScope?: boolean

  inlineJavaScript?: boolean;

  /**
   * For instances where a new tree needs to inherit from scope
   * (like Less / SCSS `@import` rule)
   */
  parentScope?: Rules;
  scope?: Rules;

  isModule?: boolean;

  file?: {
    name: string;
    path: string;
    fullPath: string;
    // contents: string[]
  };

  [k: string]: any;
}

const idChars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'.split('');

/**
 * @todo - Redo:
 *   1. Create a hash of the file path; that way hashes
 *      are unique per file, but also repeatable / predictable.
 *   2. Append file (module) hash after class name
 */
export const generateId = (length = 8) => {
  let str = '';
  let idCharsLength = idChars.length;
  for (let i = 0; i < length; i++) {
    str += idChars[Math.floor(Math.random() * idCharsLength)]!;
  }
  return str;
};

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
  opts: Record<string, any>;
  // changed to `rulesVisiblity` set during parsing
  // leakVariablesIntoScope: boolean
  mathMode: MathMode;
  unitMode: UnitMode;
  isModule: boolean;

  /** Current scope while evaluating - Remove? */
  scope: Rules | undefined;

  file?: TreeContextOptions['file'];
  /**
   * The plugin that created this tree. It will have first dibs
   * to resolve any imports.
   */
  plugin?: PluginObject;

  constructor(opts: TreeContextOptions = {}) {
    /**
     * Known options are attached to the instance.
     * Unknown options are assigned to `opts`
     */
    let {
      scope,
      parentScope,
      // hoistDeclarations,
      // leakVariablesIntoScope,
      mathMode,
      unitMode,
      isModule,
      file,
      ...rest
    } = opts;
    // this.leakVariablesIntoScope = leakVariablesIntoScope ?? false
    this.mathMode = mathMode ?? MathMode.PARENS_DIVISION;
    this.unitMode = unitMode ?? UnitMode.STRICT;
    this.isModule = isModule ?? false;
    this.file = file;
    // this.scope = scope ?? new Scope(parentScope)
    this.opts = rest;
  }
}

/**
 * .a.b.c
 * simple = 0b1
 * compound = 0b10
 * complex = 0b100
 * a = 0b1000
 * b = 0b10000
 * c = 0b100000
 *
 * .a.b.c.c = 0b111010
 */

/**
 * This is the context object used for evaluation.
 *
 * @note
 * Most of context represents "state" while evaluating.
 * There should only ever be one Context singleton per parse & evaluation.
 */
export class Context {
  readonly plugins: PluginObject[];
  readonly opts: ContextOptions;

  treeContext!: TreeContext;
  rulesContext!: Rules;

  /**
   * When getting vars, the current declaration is ommitted
   * to prevent recursion errors. Each subsequent declaration
   * is then added to prevent back-references to this one.
   *
   * We use a set here because we look it up for filtering
   */
  private _declarationScope: Set<Declaration> | undefined;
  get declarationScope() {
    return (this._declarationScope ??= new Set());
  }

  /**
   * This is set when entering rulesets so that child nodes
   * can use this to lookup values.
   */
  scope: Rules | undefined;
  /**
   * The file (eval) context should have the same ID at compile-time
   * as run-time, so this ID will be set in `toModule()` output
   *
   * @todo - Make the id a hash of the (project-relative) path + contents
   */
  id = generateId();
  ruleCounter = 0;

  private _classMap: Map<string, string> | undefined;
  get classMap() {
    return (this._classMap ??= new Map());
  }

  /**
   * The ruleset (qualified rule) frames. This is used to resolve
   * '&' when we need to.
   */
  rulesetFrames: Array<Ruleset<any>> = [];

  /** Like `@media` */
  atRuleFrames: AtRule[] = [];

  /**
   * Keys of @let variables --
   * We need this b/c we need to generate code
   * for over-riding in the exported function.
   *
   * @todo - remove?
   */
  private _exports: Set<string> | undefined;
  get exports(): Set<string> {
    return (this._exports ??= new Set());
  }

  /**
   * @todo - is this still used? Or do all toString()
   * and toTrimmedString() methods pass in depth?
   */
  depth = 0;

  root: Rules | undefined;

  /**
   * currently generating a runtime module or not
   * @todo - remove in favor of ToModuleVisitor?
   */
  // isRuntime: boolean

  /**
   * In a custom declaration's value. All nodes should
   * be preserved as-is and not evaluated, except for
   * #() expressions.
  */
  inCustom: boolean | undefined;

  /** A flag set by expressions */
  canOperate: boolean | undefined;

  /** A flag set when evaluating conditions */
  isDefault: boolean | undefined;

  /** A flag to clone nodes before mutating */
  preserveOriginalNodes: boolean | undefined;

  constructor(opts: ContextOptions = {}, plugins?: PluginObject[]) {
    this.opts = opts;
    this.plugins = plugins ?? [];
  }

  /**
   * @todo - What is this used for? I think I wrote this to resolve
   * a tree context given a file path. Ohhhh I think, essentially,
   * if something like a Less `@import` is used, we need to resolve
   * what the tree context should be for the rules, which is up to
   * the Less plugin to return.
   *
   * I'll revisit this when I finish imports.
   */
  async getTree(filePath: string, initialDirectory?: string, options?: Record<string, any>) {
    initialDirectory ??= path.dirname(filePath);
    const paths = this.opts.paths ?? [];
    options ??= {};
    options = { ...this.opts, ...options };

    const plugins = this.plugins;
    const pluginLength = plugins.length;
    let fullPath: string | undefined;
    let resolvedTree: Root | false | undefined;
    const triedPaths: string[] = [];

    let rootPlugin = this.currentTree?.plugin;

    /** If we have a root plugin, try it first */
    if (rootPlugin?.fileManager) {
      const result = rootPlugin.fileManager.getPath(filePath, initialDirectory, paths, options);
      if (isArray(result)) {
        triedPaths.push(...result);
      } else {
        fullPath = result;
      }
    }

    /** Iterate in reverse, starting with last added plugin */
    for (let i = pluginLength - 1; i >= 0; i--) {
      const plugin = plugins[i]!;
      if (plugin === rootPlugin) {
        continue;
      }
      if (!plugin.fileManager) {
        continue;
      }
      const result = plugin.fileManager.getPath(filePath, initialDirectory, paths, options);
      if (isArray(result)) {
        triedPaths.push(...result);
      } else {
        fullPath = result;
        break;
      }
    }
    if (!fullPath) {
      throw new Error('File not found');
    }

    /** If we have a root plugin, try it first */
    if (rootPlugin?.fileManager) {
      const result = await rootPlugin.fileManager.getTree(fullPath, options);
      if (result) {
        return result;
      }
    }

    for (let i = pluginLength - 1; i >= 0; i--) {
      const plugin = plugins[i]!;
      if (plugin === rootPlugin) {
        continue;
      }
      if (!plugin.fileManager) {
        continue;
      }
      const tree = await plugin.fileManager.getTree(fullPath, options);
      if (tree) {
        resolvedTree = tree;
        break;
      }
    }
    if (!resolvedTree) {
      throw new Error(`File "${path.basename(filePath)}" not supported`);
    }
    return resolvedTree;
  }

  /**
   * Hash a CSS class name or not depending on the `module` setting
   *
   * @todo - do module files have different contexts, therefore different
   * hash maps?
   */
  hashClass(name: string) {
    /** Remove dot for mapping */
    name = name.slice(1);
    let lookup = this.classMap.get(name);
    if (lookup) {
      return `.${lookup}`;
    }
    let mapVal: string;
    if (this.opts.module) {
      mapVal = `${name}_${this.id}`;
    } else {
      mapVal = name;
    }
    this.classMap.set(name, mapVal);
    return `.${mapVal}`;
  }

  getVar() {
    return `--v${this.id}-${this.varCounter++}`;
  }

  shouldOperate(op: Operator) {
    const mathMode = this.opts.mathMode;
    /** Parens for Less/SCSS will set `canOperate` to true */
    if (mathMode === MathMode.ALWAYS || this.canOperate) {
      return true;
    }
    if (mathMode === MathMode.PARENS_DIVISION) {
      return op !== '/';
    }
    if (mathMode === MathMode.PARENS) {
      return false;
    }
    return true;
  }
}