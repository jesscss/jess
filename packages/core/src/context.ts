import type {
  AtRule,
  Ruleset,
  Rules,
  ImportOptions,
  Node,
  Any,
  Selector
} from './tree/index.js';
import { EvalSession, EvalPosition, type SessionInstanceRoot } from './eval-session.js';
import { ExtendRootRegistry } from './tree/util/extend-roots.js';
import { type Operator } from './tree/util/calculate.js';
import type { PluginInterface } from './plugin.js';
import { EqualityMode, MathMode, UnitMode } from './types/modes.js';
import * as path from 'node:path';
import { isNode } from './tree/util/is-node.js';
import { N } from './tree/node-type.js';
import { shouldOperateWithMathFrames } from './tree/util/should-operate.js';
import { type ErrorDiagnostic, type WarningDiagnostic, JessError } from './jess-error.js';
import type { Call } from './tree/call.js';
import { CallMap } from './tree/util/recursion-helper.js';
import { createRequire } from 'node:module';
import { BitSetLibrary } from './tree/util/bitset.js';

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
  equalityMode?: EqualityMode;

  /** Directories to search to resolve files */
  searchPaths?: string[];

  /**
   * Whether to leak variables and mixins into the caller scope,
   * such that they can be referenced / called by subsequent rules.
   *
   * @deprecated - a Less feature
   */
  leakyRules?: boolean;

  /**
   * Whether to bubble root-only at-rules (like @font-face, @keyframes)
   * to the root level when they're nested inside rulesets.
   *
   * @deprecated - a legacy Less feature; modern CSS allows nesting
   */
  bubbleRootAtRules?: boolean;

  /**
   * Suppress warnings (similar to Less's suppressWarnings option).
   * When true, warnings are collected but not emitted.
   */
  suppressWarnings?: boolean;

  /**
   * Break on first error (stop processing after first error).
   * When false, errors are collected and processing continues.
   */
  breakOnError?: boolean;
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
  leakyRules: boolean | undefined;
  bubbleRootAtRules: boolean | undefined;
  mathMode: MathMode | undefined;
  unitMode: UnitMode | undefined;
  equalityMode: EqualityMode | undefined;

  /** @todo - Change how extend works based on this value */
  isModule: boolean | undefined;

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
      equalityMode,
      isModule,
      file,
      plugin,
      leakyRules,
      bubbleRootAtRules,
      ...rest
    } = opts;
    this.mathMode = mathMode;
    this.unitMode = unitMode;
    this.equalityMode = equalityMode;
    this.isModule = isModule;
    this.file = file;
    this.plugin = plugin;
    this.leakyRules = leakyRules;
    this.bubbleRootAtRules = bubbleRootAtRules;
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
   * Collected errors during safeParse/safeRender.
   * Only populated when using safe methods.
   */
  errors: ErrorDiagnostic[] = [];

  /**
   * Collected warnings during safeParse/safeRender.
   * Only populated when using safe methods.
   */
  warnings: WarningDiagnostic[] = [];

  /**
   * A feature ported from Less - we suppress any `@charset`
   * after the first one.
   */
  currentCharset?: Any;
  /** Track whether charset has been emitted during toString to avoid duplicates */
  charsetEmitted?: boolean;

  /** @import rules must be at the top of CSS output */
  topImports?: Node[];

  /**
   * This is set when entering rulesets so that child nodes
   * can use this to lookup values. When evaluating inside a mixin/function,
   * this also enables call-time variable resolution ($~variable).
   */
  rulesContext!: Rules;
  /**
   * Internal transient lookup-scope override.
   *
   * Used by direct mixin/function invocation so canonical bodies can evaluate
   * against a prepared outer scope without changing the public node API.
   */
  lookupScope?: Rules;
  /** Entire context root (ultimate root) */
  root!: Rules;
  /** Set so that we can do ruleset selector lookup for extend */
  treeRoot!: Rules;
  allRoots: Rules[] = [];

  /** The call that is currently being evaluated */
  caller?: Call;

  /** Extend roots registry for managing extend scoping */
  extendRoots!: ExtendRootRegistry;

  /**
   * Depth-first document order of each Ruleset (assigned once per root before eval).
   * Used so processExtends can apply extends in true source order.
   *
   * @todo - Probably remove once I fix extends
   */
  documentOrderByRuleset?: WeakMap<Ruleset, number>;

  /**
   * Registered extends with their extend root context
   * Format: [target, selectorWithExtend, partial, extendRoot, extendNode, documentOrder?, fromReferenceScope?, namespace?]
   *
   * @todo - Probably remove once I fix extends
   */
  extends: Array<[target: Selector, selectorWithExtend: Selector, partial: boolean, extendRoot: Rules, extendNode: Node, documentOrder?: number, fromReferenceScope?: boolean, namespace?: string]> = [];

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

  /** Selector valueOf() strings to bitset positions */
  selectorBits = new BitSetLibrary<string>();

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

  private _callMap: CallMap | undefined;
  get callMap() {
    return (this._callMap ??= new CallMap());
  }

  private _callStack: Call[] | undefined;
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

  /**
   * Import-evaluation scope stack.
   *
   * This intentionally models lexical import scope instead of global counters:
   * - each import branch pushes its semantics on entry
   * - each branch pops in `finally`
   * - readers ask semantic questions (`inReferenceImportScope`) instead of
   *   inspecting mutable depth values.
   *
   * Why this exists:
   * some behaviors depend on "how we got here" (call-path scope), not only
   * on the current node's own options. Example: suppressing top-level @import
   * hoists while traversing a reference-only branch.
   */
  private _importScopeStack: Array<{ reference: boolean; multiple: boolean }> = [];
  get importScope() {
    return this._importScopeStack;
  }

  get inReferenceImportScope() {
    return this._importScopeStack.some(scope => scope.reference);
  }

  get inMultipleImportScope() {
    return this._importScopeStack.some(scope => scope.multiple);
  }

  pushImportScope(scope: { reference?: boolean; multiple?: boolean }) {
    this._importScopeStack.push({
      reference: scope.reference === true,
      multiple: scope.multiple === true
    });
  }

  popImportScope() {
    if (this._importScopeStack.length > 0) {
      this._importScopeStack.pop();
    }
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
   *
   * Sometimes we "reset" the "in parentheses" state by pushing false,
   * such as within a function call.
   */
  parenFrames: boolean[] = [];

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

  /**
   * Optional evaluation session for mutation isolation.
   *
   * When set, field reads/writes should go through session-aware
   * helpers instead of mutating canonical nodes directly. When
   * undefined (the default), all behavior is unchanged — nodes
   * are the source of truth and mutation works as before.
   *
   * @see EvalSession
   */
  session: EvalSession | undefined;

  /**
   * The active instance root for the current eval scope.
   *
   * When set, field reads/writes should check the instance root's
   * sparse shadow state before falling back to the session or
   * canonical node. This enables multiple placements of the same
   * canonical subtree (e.g., repeated imports, repeated mixin calls)
   * to carry independent local state.
   *
   * @see SessionInstanceRoot
   */
  instanceRoot: SessionInstanceRoot | undefined;

  /**
   * The active position in the virtual evaluated tree.
   * Lazy — allocated on first access, zero cost if never used.
   * Mixin calls replace this with a child position for their body.
   */
  private _position: EvalPosition | undefined;
  get position(): EvalPosition | undefined {
    return this._position;
  }

  /** Lazy position access — creates root position on first call */
  /** Lazy position access — creates a root position on first write. */
  ensurePosition(): EvalPosition {
    if (!this._position) {
      this._position = new EvalPosition(this.root!);
    }
    return this._position;
  }

  set position(value: EvalPosition | undefined) {
    this._position = value;
  }

  /** Create and attach a new EvalSession to this context. */
  createSession(): EvalSession {
    this.session = new EvalSession({ resetEvalState: true });
    return this.session;
  }

  _leakyRules: boolean | undefined;
  get leakyRules() {
    return this._leakyRules ?? this.treeContext?.leakyRules ?? false;
  }

  _bubbleRootAtRules: boolean | undefined;
  get bubbleRootAtRules() {
    return this._bubbleRootAtRules ?? this.treeContext?.bubbleRootAtRules ?? false;
  }

  constructor(opts: ContextOptions = {}, plugins?: PluginInterface[]) {
    this.opts = opts;
    this.plugins = plugins ?? [];
    this.extendRoots = new ExtendRootRegistry();
    if (opts.leakyRules !== undefined) {
      this._leakyRules = opts.leakyRules;
    }
    if (opts.bubbleRootAtRules !== undefined) {
      this._bubbleRootAtRules = opts.bubbleRootAtRules;
    }
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
      // Fallback for bare module specifiers (e.g. "@scope/pkg/path").
      const looksBareSpecifier = (p: string) =>
        !path.isAbsolute(p)
        && !p.startsWith('./')
        && !p.startsWith('../')
        && !p.startsWith('/')
        && !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(p);
      const tryResolveModule = (request: string, basedir: string): string | undefined => {
        try {
          const req = createRequire(path.join(basedir, '__jess_resolve__.js'));
          return req.resolve(request);
        } catch {
          return undefined;
        }
      };
      const moduleBaseDirs = [currentDirectory, ...searchPaths, process.cwd()];
      for (const candidate of paths) {
        if (!looksBareSpecifier(candidate)) {
          continue;
        }
        for (const baseDir of moduleBaseDirs) {
          const base = path.isAbsolute(baseDir) ? baseDir : path.resolve(currentDirectory, baseDir);
          const resolved = tryResolveModule(candidate, base) ?? tryResolveModule(`${candidate}.less`, base);
          if (resolved) {
            finalPath = resolved;
            break;
          }
        }
        if (finalPath) {
          break;
        }
      }
    }

    if (!finalPath) {
      /** @todo - Add messaging around tried paths */
      throw new Error(`File not found: ${importPath} (from: ${currentDirectory})`);
    }

    const normalizedFinalPath = finalPath.split(/[?#]/)[0]!;
    const ext = path.extname(normalizedFinalPath);
    const friendlyPath = path.relative(process.cwd(), normalizedFinalPath);

    if (!ext) {
      throw new Error(`File "${friendlyPath}" not supported`);
    }

    return {
      triedPaths: paths,
      resolvedPath: normalizedFinalPath,
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
      const plugin = plugins.find(plugin => plugin.supportedExtensions?.includes(extension) && (plugin.parse || plugin.safeParse));
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
    const parseResult = plugin.safeParse!(resolvedPath, source, {
      compilerOptions: this.opts as Record<string, any>
    });

    // Collect normalized errors and warnings from plugin
    this.errors.push(...parseResult.errors);
    this.warnings.push(...parseResult.warnings);

    // Check if we have errors and should break
    if (parseResult.errors.length > 0 && this.opts.breakOnError !== false) {
      // Throw the first error as a JessError
      const firstError = parseResult.errors[0]!;
      throw new JessError({
        code: firstError.code as any,
        phase: firstError.phase,
        severity: 'error',
        ctx: firstError.file ? { file: firstError.file } : undefined,
        filePath: firstError.filePath,
        source: firstError.file?.source,
        line: firstError.line,
        column: firstError.column,
        reason: firstError.reason,
        fix: firstError.fix,
        note: firstError.note,
        errors: firstError.errors,
        lexerErrors: firstError.lexerErrors
      });
    }

    if (parseResult.tree) {
      // Set context.root so preEval visitors can check if this is the root
      // parseResult.tree should be a Rules node (the root of the parsed tree)
      if (!this.root && isNode(parseResult.tree, N.Rules)) {
        this.root = parseResult.tree;
      }

      this.sourceTrees.set(resolvedPath, parseResult.tree);
      return {
        node: parseResult.tree,
        triedPaths,
        resolvedPath
      };
    }

    // No tree and no errors means unsupported file
    const notSupportedError = new Error(`File "${friendlyPath}" not supported`);
    if (this.opts.breakOnError !== false) {
      throw notSupportedError;
    }
    // Add error for unsupported file
    this.errors.push({
      code: 'parse/unsupported-file',
      phase: 'parse',
      message: notSupportedError.message,
      reason: `The file "${friendlyPath}" is not supported by any available plugin.`,
      fix: 'Ensure the file has a supported extension or specify a plugin type.',
      filePath: resolvedPath,
      line: 1,
      column: 1
    });
    return {
      node: null as any,
      triedPaths,
      resolvedPath
    };
  }

  /**
   * Public path resolution for import nodes that need source-path lookups
   * without triggering parse/eval.
   */
  async resolveImportPath(importPath: string) {
    return this._getPath(importPath);
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
    const tree = await plugin.parse!(virtualPath, content, {
      compilerOptions: this.opts as Record<string, any>
    });

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
    const isFnsImport = importPath === '@jesscss/fns'
      || importPath.startsWith('@jesscss/fns/')
      || importPath === '#less'
      || importPath.startsWith('#less/')
      || importPath === '#sass'
      || importPath.startsWith('#sass/');
    const { enableJavaScript } = this.opts;
    if (enableJavaScript === false && !isFnsImport) {
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
        if (['.js', '.mjs', '.cjs', '.ts', '.mts', '.cts'].includes(ext)) {
          throw new Error('Feature not supported. Install @jesscss/plugin-js to enable script execution features.');
        }
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
  //   withNode?: StyleImportValue['withNode']
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
    const mathMode = this.treeContext?.mathMode
      ?? this.opts?.mathMode
      ?? 'parens-division';
    return shouldOperateWithMathFrames(
      {
        mathMode,
        parenFrames: this.parenFrames,
        calcFrames: this.calcFrames
      },
      op,
      left,
      right
    );
  }
}
