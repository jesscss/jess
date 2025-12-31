import type {
  AtRule,
  Ruleset,
  Rules,
  ImportOptions,
  Node,
  Any,
  Selector,
  Mixin
} from './tree';
import { ExtendRootRegistry } from './tree/util/extend-roots';
import { type Operator } from './tree/util/calculate';
import type { PluginInterface } from './plugin';
import { MathMode, UnitMode } from './types/modes';
import * as path from 'node:path';
import { isNode } from './tree/util/is-node';
import { isThenable } from '@jesscss/awaitable-pipe';

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

  enableJavaScript?: boolean;
  mathMode?: MathMode;
  unitMode?: UnitMode;

  /** Directories to search to resolve files */
  searchPaths?: string[];

  /**
   * Whether to leak variables and mixins into the caller scope,
   * such that they can be referenced / called by subsequent rules.
   *
   * @deprecated - a Less feature
   */
  leakyRules?: boolean;
}

export interface TreeContextOptions extends ContextOptions {
  inlineJavaScript?: boolean;

  /**
   * For instances where a new tree needs to inherit from scope
   * (like Less / SCSS `@import` rule)
   *
   * @todo - remove?
   */
  parentScope?: Rules;
  scope?: Rules;

  isModule?: boolean;

  file?: {
    /** Filename, e.g. "main.jess" */
    name: string;

    /** Absolute directory containing the file (no filename) */
    path: string;

    /** Absolute file path (directory + filename) */
    fullPath: string;

    /** Full file contents (recommended for code-frames) */
    source?: string;

    /** Lazy cache of line-start offsets (built on demand) */
    lines?: Uint32Array;
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
 * as an object reference.
 *
 * Additionally, it sets options that may be
 * unique to the tree, such as the math mode.
 */
export class TreeContext implements TreeContextOptions {
  opts: Record<string, any>;
  // changed to `rulesVisiblity` set during parsing
  leakyRules: boolean;
  mathMode: MathMode;
  unitMode: UnitMode;

  /** @todo - Change how extend works based on this value */
  isModule: boolean;

  file?: TreeContextOptions['file'];
  /**
   * The plugin that created this tree. It will have first dibs
   * to resolve any imports.
   */
  plugin?: PluginInterface;

  constructor(opts: TreeContextOptions = {}) {
    /**
     * Known options are attached to the instance.
     * Unknown options are assigned to `opts`
     */
    let {
      mathMode,
      unitMode,
      isModule,
      file,
      plugin,
      leakyRules,
      ...rest
    } = opts;
    // this.leakVariablesIntoScope = leakVariablesIntoScope ?? false
    this.mathMode = mathMode ?? 'parens-division';
    this.unitMode = unitMode ?? 'strict';
    this.isModule = isModule ?? false;
    this.file = file;
    this.plugin = plugin;
    this.leakyRules = leakyRules ?? false;
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
  readonly plugins: PluginInterface[];
  readonly opts: ContextOptions;

  treeContext!: TreeContext;

  /**
   * A feature ported from Less - we suppress any `@charset`
   * after the first one.
   */
  currentCharset?: Any;
  /** Track whether charset has been emitted during toString to avoid duplicates */
  charsetEmitted?: boolean;

  topRules?: Node[];

  /**
   * This is set when entering rulesets so that child nodes
   * can use this to lookup values.
   */
  rulesContext!: Rules;
  /**
   * When evaluating inside a mixin/function, this tracks the call site position
   * for call-time variable resolution ($~variable).
   */
  callSiteIndex?: number;
  /** Entire context root (ultimate root) */
  root!: Rules;
  /** Set so that we can do ruleset selector lookup for extend */
  treeRoot!: Rules;
  allRoots: Rules[] = [];

  /** Extend roots registry for managing extend scoping */
  extendRoots!: ExtendRootRegistry;

  /**
   * Registered extends with their extend root context
   * Format: [target, selectorWithExtend, partial, extendRoot, extendNode]
   */
  extends: Array<[target: Selector, selectorWithExtend: Selector, partial: boolean, extendRoot: Rules, extendNode: Node]> = [];

  /**
   * When doing any kind of lookup, the current node and resolved
   * nodes in the search chain are added to prevent recursion errors.
   *
   * We use a set here because we look it up for filtering.
   * Also used to track mixins currently being evaluated to prevent infinite recursion.
   */
  private _searchScope: Set<Node> | undefined;
  get searchScope() {
    return (this._searchScope ??= new Set());
  }

  /**
   * The file (eval) context should have the same ID at compile-time
   * as run-time, so this ID will be set in `toModule()` output
   *
   * @todo - Make the id a hash of the (project-relative) path + contents
   */
  id = generateId();
  ruleCounter = 0;

  /** Rules depth, used to figure out source order */
  depth = -1;

  private _classMap: Map<string, string> | undefined;
  get classMap() {
    return (this._classMap ??= new Map());
  }

  /** Frames for nested rulesets, used for selector evaluation */
  rulesetFrames: Ruleset[] = [];
  /** Unified frames array for flat rendering when collapseNesting is true */
  frames: (Ruleset | AtRule)[] = [];

  /**
   * We push a boolean to this array when entering a calc() call
   * and pop it when leaving. This helps us determine if operations
   * should be performed or not.
   *
   * @todo - can't this just be a number?
   */
  calcFrames = 0;

  private _callStack: Node[] | undefined;
  get callStack() {
    return (this._callStack ??= []);
  }

  /**
   * Stack to track reference call chain for clearing matched keys at outermost level
   */
  private _referenceStack: number = 0;
  get referenceStack() {
    return this._referenceStack;
  }

  pushReference() {
    this._referenceStack++;
  }

  /**
   * Stack to track when a value comes from an important declaration
   * Used to propagate !important flag to containing declarations
   */
  private _importantSourceStack: number = 0;
  get hasImportantSource() {
    return this._importantSourceStack > 0;
  }

  pushImportantSource() {
    this._importantSourceStack++;
  }

  popImportantSource() {
    if (this._importantSourceStack > 0) {
      this._importantSourceStack--;
    }
  }

  popReference() {
    this._referenceStack--;
  }

  rulesEvalStack: Rules[] = [];

  /**
   * We push a boolean to this array when entering parens call
   * and pop it when leaving. This helps us determine if operations
   * should be performed or not.
   */
  parenFrames = 0;

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
   * currently generating a runtime module or not
   * @todo - remove in favor of ToModuleVisitor?
   */
  // isRuntime: boolean

  /**
   * In a custom declaration's value. All nodes should
   * be preserved as-is and not evaluated, except for
   * $() expressions.
  */
  inCustom: boolean | undefined;

  /** A flag set when evaluating conditions */
  isDefault: boolean | undefined;

  /** A flag to clone nodes before mutating */
  preserveOriginalNodes: boolean | undefined;

  get leakyRules() {
    return this.treeContext.leakyRules ?? false;
  }

  constructor(opts: ContextOptions = {}, plugins?: PluginInterface[]) {
    this.opts = opts;
    this.plugins = plugins ?? [];
    this.extendRoots = new ExtendRootRegistry();
    this.treeContext = new TreeContext(opts);
  }

  /** Full resolved path -> tree */
  sourceTrees = new Map<string, Rules>();
  evaldTrees = new Map<string, Rules>();

  /**
   * @param importPath - The bare import path e.g. `@import "foo";` in a .less file.
   */
  private async _getPath(importPath: string) {
    const currentTree = this.treeContext;
    const currentDirectory = currentTree?.file?.path ?? process.cwd();
    const { searchPaths = [] } = this.opts;

    const plugins = this.plugins;
    let finalPath: string | undefined;
    let currentPlugin = this.treeContext?.plugin;

    /** First, expand imports */
    let paths = currentPlugin?.expandImport?.(importPath, currentDirectory) ?? [importPath];
    if (paths.length === 0) {
      throw new Error(`No paths found for import "${importPath}"`);
    }

    /** Give current context plugin first dibs to resolve */
    if (currentPlugin?.resolve) {
      const result = await currentPlugin.resolve(paths, currentDirectory, searchPaths);
      if (result) {
        paths = result;
      }
    }

    /** Try to resolve using resolver plugins */
    for (const plugin of plugins) {
      if (plugin === currentPlugin) {
        continue;
      }
      if (!plugin.resolve) {
        continue;
      }
      const result = await plugin.resolve(paths, currentDirectory, searchPaths);
      if (result) {
        paths = result;
      }
    }

    /** Now, try to locate the first matching file using locator plugins */
    for (const plugin of plugins) {
      if (!plugin.locate) {
        continue;
      }
      const result = await plugin.locate(paths, currentDirectory);
      if (result) {
        finalPath = result;
        break;
      }
    }

    if (!finalPath) {
      /** @todo - Add messaging around tried paths */
      throw new Error('File not found');
    }

    const ext = path.extname(finalPath);
    const friendlyPath = path.relative(process.cwd(), finalPath);

    if (!ext) {
      throw new Error(`File "${friendlyPath}" not supported`);
    }

    return {
      triedPaths: paths,
      resolvedPath: finalPath,
      friendlyPath
    };
  }

  /**
   * Find the appropriate plugin for parsing based on type or extension
   */
  private findParserPlugin(type?: string, extension?: string): PluginInterface {
    const plugins = this.plugins;

    if (type) {
      const plugin = plugins.find(plugin => plugin.name === type);
      if (!plugin) {
        throw new Error(`Plugin "${type}" not found`);
      }
      if (!plugin.parse) {
        throw new Error(`Plugin "${type}" does not support parsing`);
      }
      return plugin;
    }

    if (extension) {
      const plugin = plugins.find(plugin => plugin.supportedExtensions?.includes(extension) && plugin.parse);
      if (!plugin) {
        throw new Error(`No plugin found for extension "${extension}"`);
      }
      return plugin;
    }

    throw new Error('No plugin type or extension specified');
  }

  async getTree(importPath: string, importOptions: ImportOptions = {}) {
    const { resolvedPath, triedPaths, friendlyPath } = await this._getPath(importPath);
    const { type } = importOptions;
    /**
     * We already have resolved this file and parsed it.
     */
    if (this.sourceTrees.has(resolvedPath)) {
      return {
        node: this.sourceTrees.get(resolvedPath)!,
        triedPaths,
        resolvedPath
      };
    }

    const plugins = this.plugins;

    const sourceGetter = plugins.find(plugin => plugin.getSource);
    if (!sourceGetter) {
      /** If we can't actually load files, bail. */
      throw new Error('No source getter found');
    }

    const ext = path.extname(resolvedPath);
    const plugin = this.findParserPlugin(type, ext);
    let source: string;
    try {
      source = await sourceGetter.getSource!(resolvedPath);
    } catch (error: any) {
      throw error;
    }
    const parseResult = plugin.parse!(resolvedPath, source);
    const tree = isThenable(parseResult)
      ? await parseResult
      : parseResult;
    if (tree) {
      this.sourceTrees.set(resolvedPath, tree);
      return {
        node: tree,
        triedPaths,
        resolvedPath
      };
    }

    throw new Error(`File "${friendlyPath}" not supported`);
  }

  /**
   * Parse a string content directly using the appropriate plugin
   */
  async parseString(content: string, options: {
    filePath?: string;
    type?: string;
    extension?: string;
  } = {}) {
    const { filePath, type, extension } = options;
    const virtualPath = filePath || `virtual.${extension || 'jess'}`;
    const ext = extension || path.extname(virtualPath);

    const plugin = this.findParserPlugin(type, ext);
    const tree = await plugin.parse!(virtualPath, content);

    if (!tree) {
      throw new Error('Failed to parse content');
    }

    return {
      node: tree,
      resolvedPath: virtualPath
    };
  }

  /**
   *
   * @param importPath
   * @param importOptions
   */
  async getModule(importPath: string, importOptions: ImportOptions = {}) {
    const { enableJavaScript } = this.opts;
    if (enableJavaScript === false) {
      throw new Error('JavaScript evaluation is disabled');
    }
    const { resolvedPath, triedPaths, friendlyPath } = await this._getPath(importPath);
    const { type } = importOptions;

    const plugins = this.plugins;
    const ext = path.extname(resolvedPath);

    let plugin: PluginInterface | undefined;

    if (type) {
      plugin = plugins.find(plugin => plugin.name === type);
      if (!plugin) {
        throw new Error(`Plugin "${type}" not found`);
      }
      if (!plugin.import) {
        throw new Error(`Plugin "${type}" can't import modules`);
      }
    }

    if (!plugin) {
      plugin = plugins.find(plugin => plugin.supportedExtensions?.includes(ext) && plugin.import);
      if (!plugin) {
        throw new Error(`File "${friendlyPath}" not supported`);
      }
    }

    const module = await plugin.import!(resolvedPath);
    if (!module) {
      throw new Error(`File "${friendlyPath}" not supported`);
    }

    return {
      module,
      triedPaths,
      resolvedPath
    };
  }

  // async getRules(
  //   filePath: string,
  //   nodeOptions: StyleImportOptions,
  //   userOptions: Record<string, any> = {},
  //   withValues?: StyleImportValue['with']
  // ) {
  //   let rules = await this.getTree(filePath, userOptions);
  //   if (withValues && isNode(withValues.node, 'Rules')) {
  //     if (rules.options.readonly) {
  //       throw new Error('Cannot set an import\'s "with" values more than once.');
  //     }
  //     /** @todo - Throw errors for undefined vars */
  //     let withRules = withValues.node.clone(true) as Rules;
  //     withRules.value.unshift(rules);
  //     rules = withRules;
  //     if (withValues.type === 'set') {
  //       this.sourceTrees.set(filePath, rules);
  //     }
  //   }
  //   return rules;
  // }

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

  shouldOperate(op: Operator, left: Node, right: Node) {
    const mathMode = this.opts.mathMode;
    const inParens = this.parenFrames !== 0;
    const inCalc = this.calcFrames !== 0;
    if (inCalc) {
      /** Only collapse safe units */
      if (
        isNode(left, 'Dimension')
        && isNode(right, 'Dimension')
      ) {
        let lUnit = left.value.unit;
        let rUnit = right.value.unit;
        if (
          (op === '+' || op === '-')
          && lUnit === rUnit
        ) {
          return true;
        }
        /** Can't make square units */
        if (op === '*' && (!lUnit || !rUnit)) {
          return true;
        }
        /** Can't divide by a unit */
        if (op === '/' && !lUnit) {
          return true;
        }
      }

      return false;
    }
    /** Parens for Less/SCSS will set `canOperate` to true */
    if (mathMode === 'always' || inParens) {
      return true;
    }
    if (mathMode === 'parens-division') {
      return op !== '/';
    }
    if (mathMode === 'parens' || mathMode === 'strict') {
      return false;
    }
    return true;
  }
}