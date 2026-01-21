import {
  Node,
  defineType,
  type NodeOptions,
  type LocationInfo,
  type TreeContext,
  F_STATIC,
  F_VISIBLE
} from './node.js';
import { Context } from '../context.js';
import { isNode } from './util/is-node.js';
import { comparePosition } from './util/compare.js';
import { cast } from './util/cast.js';
import { type Ruleset } from './ruleset.js';
import { type Mixin } from './mixin.js';
import type { Selector } from './selector.js';
import { spaced, Sequence } from './sequence.js';
import { type PrintOptions, getPrintOptions } from './util/print.js';

import { atIndex } from './util/collections.js';
import type { Condition } from './condition.js';
import type { Bool } from './bool.js';
import * as Registries from './util/registry-utils.js';
import { processExtends } from './util/extend-roots.js';
import { syncLog } from './util/__tests__/debug-log.js';
import { type MaybePromise, pipe, isThenable, serialForEach, tryStep } from '@jesscss/awaitable-pipe';
import { Nil } from './nil.js';
import { VarDeclaration } from './declaration-var.js';
import { Any } from './any.js';
import { List } from './list.js';
import { indent, normalizeIndent } from './util/serialize-helper.js';
import { freezeChildren } from './util/cloning.js';

const { isArray } = Array;

// #region agent log
let __agentRulesLogCount = 0;
function agentRulesLog(context: Context, location: string, message: string, data: Record<string, unknown>) {
  if (process.env.DEBUG_EXTEND_BOOT !== 'true') return;
  if (__agentRulesLogCount++ > 20) return;
  const filePath = context.treeContext?.file?.fullPath
    || (context.treeContext?.file?.path && context.treeContext?.file?.name
      ? `${context.treeContext.file.path}/${context.treeContext.file.name}`
      : context.treeContext?.file?.path)
    || '';
  if (typeof filePath === 'string' && !filePath.includes('tests-unit/extend-selector')) return;
  syncLog({
    sessionId: 'debug-session',
    runId: process.env.DEBUG_RUN_ID || 'pre-fix',
    hypothesisId: 'H6',
    location,
    message,
    data,
    timestamp: Date.now()
  });
}
// #endregion

// #region agent log
let __agentBootLogCount = 0;
function agentBootLog(context: Context, location: string, message: string, data: Record<string, unknown>) {
  if (process.env.DEBUG_EXTEND_BOOT !== 'true') return;
  if (__agentBootLogCount++ > 200) return;
  const filePath = context.treeContext?.file?.fullPath
    || (context.treeContext?.file?.path && context.treeContext?.file?.name
      ? `${context.treeContext.file.path}/${context.treeContext.file.name}`
      : context.treeContext?.file?.path)
    || '';
  if (typeof filePath !== 'string' || !filePath.includes('tests-unit/extend-selector')) return;
  const currentRuleset = context.rulesetFrames.at(-1);
  const currentSel = currentRuleset && 'value' in currentRuleset && (currentRuleset as any).value?.selector
    ? String((currentRuleset as any).value.selector.valueOf?.() ?? '')
    : '';
  // Only log for the suspected hang ruleset to keep noise down.
  if (!currentSel.includes('.attributes')) return;
  syncLog({
    sessionId: 'debug-session',
    runId: process.env.DEBUG_RUN_ID || 'pre-fix',
    hypothesisId: 'H9',
    location,
    message,
    data: { ...data, currentSel },
    timestamp: Date.now()
  });
}
// #endregion

export const enum Priority {
  None = 0,
  Low = 1,
  Medium = 2,
  High = 3,
  Highest = 4
}
export type RulesVisibility = 'public' | 'optional' | 'private';

export type RulesOptions = {
  /**
   * - public   = all members are considered in lookup algorithms
   * - optional = members are only considered if not found in the lookup tree
   * - private  = can't be looked up
   * - local    = only visible in the current scope
   *
   * Different types may have different defaults
   *
   * For Less:
   *   - When mixins are parsed, their rules body is set to:
   *     visibility: {
   *       Ruleset: 'public',
   *       Declaration: 'public',
   *       VarDeclaration: 'optional',
   *       Mixin: 'public'
   *     }
   *  - When detached rulesets are parsed, their rules body is set to:
   *    visibility: {
   *      Ruleset: 'public',
   *      Declaration: 'public',
   *      VarDeclaration: 'private', <-- the one notable difference
   *      Mixin: 'public'
   *    }
   * @note - The reason Less has "optionality" is likely because it tries
   * to eagerly resolve variables, so even though its in a
   * child scope, it will still be considered if nothing else in the
   * scope is found. I'm guessing this is because "overwriting" a local
   * variable from something like a mixin call would be counter-intuitive,
   * but at the same time, I guess Alexis thought that eagerly resolving
   * the variable might be useful.
   *
   * Note that right now, only Declarations being set to "optional"
   * are supported. Everything else must be public or private.
   *
   * For Imports, the rules body is set to:
   *     visibility: {
   *       Ruleset: 'public',
   *       Declaration: 'public',
   *       VarDeclaration: 'public',
   *       Mixin: 'public'
   *    }
   */
  rulesVisibility?: Record<string, RulesVisibility>;
  /**
   * If true, this Rules node is output from a mixin call.
   * References with a target (e.g., #ns[@foo]) have public access to all nodes in these Rules.
   * References without a target (e.g., @foo) cannot access these Rules.
   */
  isMixinOutput?: boolean;
  readonly?: boolean;
  /**
   * all imports other than classic `@import` set returned rules to local.
   * The reason is that variables are not transitive, and you need to re-use
   * modules to get the same variables.
   */
  local?: boolean;
  /**
   * Sass `@forward` semantics: this Rules node exists as an export surface for downstream
   * consumers, but should not be visible to lookups within the current stylesheet scope.
   */
  forward?: boolean;
};

export interface Rules extends Node<Node[], RulesOptions & NodeOptions> {
  get options(): RulesOptions & NodeOptions & {
    rulesVisibility: Record<string, RulesVisibility>;
  };
  set options(options: RulesOptions & NodeOptions & {
    rulesVisibility: Record<string, RulesVisibility>;
  });
  eval(context: Context): MaybePromise<this>;
}
/**
 * The class representing a "declaration list".
 * CSS calls it this even though CSS Nesting
 * adds a bunch more things that aren't declarations.
 *
 * Used by Ruleset and Mixin. Additionally, imports / use statements
 * return rules.
 *
 * @example
 * [
 *   (Declaration color: black;)
 *   (Declaration background-color: white;)
 * ]
 */
export class Rules extends Node<Node[], RulesOptions & NodeOptions> {
  type = 'Rules';
  shortType = 'rules';
  override allowRuleRoot = true;
  override allowRoot = true;

  rulesetRegistry: Registries.RulesetRegistry | undefined;
  mixinRegistry: Registries.MixinRegistry | undefined;
  declarationRegistry: Registries.DeclarationRegistry | undefined;
  functionRegistry: Registries.FunctionRegistry | undefined;

  rulesIndexed = 0;
  _indexing = false;

  _indexRules() {
    if (this._indexing) {
      return; // Prevent recursive indexing
    }
    this._indexing = true;
    try {
      let value = this.value;
      let length = value.length;
      for (let i = this.rulesIndexed; i < length; i++) {
        const node = value[i]!;
        this.registerNode(node);
      }
      this.rulesIndexed = length;
    } finally {
      this._indexing = false;
    }
  }

  /**
   * Rules are often cloned during `preEval()` when `context.preserveOriginalNodes`
   * is enabled. If callers register functions/mixins/declarations on the parsed tree
   * before evaluation (e.g. via visitors), those registries must survive cloning so
   * lookups during evaluation work as expected.
   */
  override clone(deep?: boolean, cloneFn?: (n: Node) => Node): this {
    const newRules = super.clone(deep, cloneFn);

    // Preserve registries across clones by reusing the registry instances but
    // rebinding them to the cloned Rules node.
    if (this.declarationRegistry) {
      (this.declarationRegistry as any).rules = newRules;
      (newRules as any).declarationRegistry = this.declarationRegistry;
    }
    if (this.mixinRegistry) {
      (this.mixinRegistry as any).rules = newRules;
      (newRules as any).mixinRegistry = this.mixinRegistry;
    }
    if (this.functionRegistry) {
      (this.functionRegistry as any).rules = newRules;
      (newRules as any).functionRegistry = this.functionRegistry;
    }
    if (this.rulesetRegistry) {
      (this.rulesetRegistry as any).rules = newRules;
      (newRules as any).rulesetRegistry = this.rulesetRegistry;
    }

    return newRules;
  }

  /**
   * Lazily create registries for types as needed.
   */
  register(
    type: 'ruleset' | 'declaration' | 'mixin' | 'function',
    node: Node
  ) {
    let registry = this[`${type}Registry`];
    if (!registry) {
      let className = `${type.charAt(0).toUpperCase()}${type.slice(1)}` as Capitalize<typeof type>;
      let RegistryClass = Registries[`${className}Registry`];
      registry = new RegistryClass(this);
      (this as any)[`${type}Registry`] = registry;
    }
    const result = (registry as any).add(node);
    return result;
  }

  getRegistry(type: 'ruleset'): Registries.RulesetRegistry;
  getRegistry(type: 'declaration'): Registries.DeclarationRegistry;
  getRegistry(type: 'mixin'): Registries.MixinRegistry;
  getRegistry(type: 'function'): Registries.FunctionRegistry;
  getRegistry(type: 'ruleset' | 'declaration' | 'mixin' | 'function'): Registries.RulesetRegistry | Registries.DeclarationRegistry | Registries.MixinRegistry | Registries.FunctionRegistry;
  getRegistry(type: 'ruleset' | 'declaration' | 'mixin' | 'function') {
    let registry = this[`${type}Registry`];
    if (!registry) {
      /**
       * @note - Ideally we wouldn't create a registry object if we didn't have to,
       * just to find. But the find methods have complex logic for searching parent
       * and children rules / registries.
       */
      let className = `${type.charAt(0).toUpperCase()}${type.slice(1)}` as Capitalize<typeof type>;
      let RegistryClass = Registries[`${className}Registry`];
      registry = new RegistryClass(this);
      (this as any)[`${type}Registry`] = registry;
    }
    if (this.rulesIndexed < this.value.length) {
      this._indexRules();
    }
    return registry;
  }

  /**
   * This wrapper is used so we don't prematurely create a registry
   * just to search it.
   */
  find(type: 'ruleset', keys: string | string[] | Set<string>, filterType?: string, options?: Registries.FindOptions): ReturnType<Registries.RulesetRegistry['find']> | undefined;
  find(type: 'declaration', keys: string, filterType?: string, options?: Registries.DeclarationFindOptions): ReturnType<Registries.DeclarationRegistry['find']> | undefined;
  find(type: 'mixin', keys: string | string[], filterType?: string, options?: Registries.FindOptions): ReturnType<Registries.MixinRegistry['find']> | undefined;
  find(type: 'function', keys: string, filterType?: string, options?: Registries.FindOptions): ReturnType<Registries.FunctionRegistry['find']> | undefined;
  find(type: 'ruleset' | 'declaration' | 'mixin' | 'function', key: string, filterType: string, options?: Registries.FindOptions): ReturnType<Registries.RulesetRegistry['find']> | ReturnType<Registries.DeclarationRegistry['find']> | ReturnType<Registries.MixinRegistry['find']> | ReturnType<Registries.FunctionRegistry['find']> | undefined;
  find(
    type: 'ruleset' | 'declaration' | 'mixin' | 'function',
    keys: string | string[] | Set<string>,
    filterType?: string,
    options: Registries.FindOptions = {}
  ): ReturnType<Registries.RulesetRegistry['find']> | ReturnType<Registries.DeclarationRegistry['find']> | ReturnType<Registries.MixinRegistry['find']> | ReturnType<Registries.FunctionRegistry['find']> | undefined {
    let registry = this.getRegistry(type);
    return (registry as any).find(keys, filterType, options);
  }

  override toString(options?: PrintOptions): string {
    if (!this.visible && !this.fullRender) {
      return '';
    }
    options = getPrintOptions(options);
    const w = options.writer!;
    const depth = options.depth!;
    const mark = w.mark();

    const ctx = options.context;
    if (depth === 0) {
      // Snapshot global emit-tracking so repeated `.toString()` calls remain stable.
      const __prevCharsetEmitted = ctx?.charsetEmitted;
      const __prevTopImports = ctx?.topImports ? [...ctx.topImports] : undefined;
      // @charset must be first
      if (ctx?.currentCharset && !ctx.charsetEmitted) {
        const charset = ctx.currentCharset;
        // Use capture to avoid double-writing (toTrimmedString writes to writer AND returns the string)
        const charsetStr = w.capture(() => charset.toTrimmedString(options));
        w.add(charsetStr, charset);
        w.add('\n');
        // Do not permanently flip `charsetEmitted` here; restore at end.
        ctx.charsetEmitted = true;
      }
      // @import must come after @charset but before other rules
      if (ctx?.topImports?.length) {
        for (const importRule of ctx.topImports) {
          const importStr = w.capture(() => importRule.toString(options));
          w.add(normalizeIndent(importStr, ''), importRule);
          w.add('\n');
        }
        // Do not permanently clear; restore at end.
      }
      // Restore global tracking (we only needed it during this print).
      if (ctx) {
        ctx.charsetEmitted = __prevCharsetEmitted;
        if (__prevTopImports) {
          ctx.topImports = __prevTopImports;
        }
      }
    }

    this.processPrePost('pre', '', options);
    const bodyMark = w.mark();
    const bodyStr = this.toTrimmedString(options);
    const bodyEmitted = w.getSince(bodyMark);
    if (bodyEmitted.length === 0 && bodyStr) {
      w.add(bodyStr);
    }
    // At root level, ensure output ends with a single newline (standard for CSS files)
    // Don't propagate all the last child's post content (which may have extra whitespace)
    if (depth === 0) {
      const result = w.getSince(mark).trimEnd();
      // Ensure exactly one trailing newline (only if there's content)
      return result ? result + '\n' : '';
    }
    return w.getSince(mark);
  }

  pendingExtends = new Set<[find: Selector, extendWith: Selector, partial: boolean]>();

  constructor(
    value: Node[],
    options?: RulesOptions & NodeOptions,
    location?: LocationInfo,
    treeContext?: TreeContext
  ) {
    let rulesVisibility = options?.rulesVisibility ?? {};
    // Set defaults for API-created Rules. Parsers will override these as needed:
    // - Less mixins/rulesets: VarDeclaration = 'optional', Mixin = 'public'
    // - Sass mixins/rulesets: VarDeclaration = 'private', Mixin = 'private'
    // - Imports: VarDeclaration = 'public', Mixin = 'public'
    // Default to 'public' for API-created Rules (better DX - variables are accessible).
    // If you want nested Rules to be private, set it explicitly.
    rulesVisibility.Declaration ??= 'public';
    rulesVisibility.Ruleset ??= 'public';
    rulesVisibility.VarDeclaration ??= 'public';
    rulesVisibility.Mixin ??= 'public';
    // Merge with existing options to preserve rulesVisibility
    const mergedOptions = { ...options, rulesVisibility };
    super(value ?? [], mergedOptions, location, treeContext);
  }

  * [Symbol.iterator]() {
    let value = this.value;
    /**
     * This should always be the case? But at one point something somewhere
     * set the value to undefined I think, so just leaving this defensively.
     */
    if (isArray(value)) {
      yield* value.entries();
    }
  }

  /**
   * Used by Ruleset, Mixins, and AtRules etc to render
   * rules with braces.
   */
  toBraced(options?: PrintOptions) {
    let opts = getPrintOptions(options);
    // Use options.depth if provided, otherwise calculate from frameState
    const depth = opts.depth!;
    const w = opts.writer!;
    const mark = w.mark();
    let space = ''.padStart(depth * 2);
    w.add('{');
    // Set depth for _emitRulesBody - children should be one level deeper
    const childOptions = { ...opts, depth: depth + 1 };
    childOptions.writer!.add('\n');
    this._emitRulesBody(childOptions);
    // ensure closing brace is on its own properly indented line
    w.add('\n');
    if (depth !== 0) {
      w.add(space);
    }
    w.add('}');
    // At root level (depth === 0), don't add a newline after the closing brace
    // The parent _emitRulesBody will add the newline before the next item
    // For nested rules (depth > 0), the newline is handled by the parent's _emitRulesBody
    return w.getSince(mark);
  }

  private _emitRulesBody(options: PrintOptions) {
    const w = options.writer!;
    const depth = options.depth ?? 0;
    const space = indent(depth);
    const { value } = this;

    // Skip charset nodes - they are collected and prepended at root level
    // Nil nodes are now non-visible, so they're automatically filtered by n.visible
    const items = value.filter(n => n.visible);

    if (items.length === 0) {
      return;
    }

    // No spacing flags; writer.capture is used where needed

    for (let idx = 0; idx < items.length; idx++) {
      const n = items[idx]!;
      if (idx > 0) {
        // Check actual buffer state - not just previous captured output
        // Frame closing in serializeRulesContainer adds newlines that aren't in the capture
        const currentBuffer = w.getSince(0);
        const bufferEndsWithNewline = currentBuffer.endsWith('\n');
        if (!bufferEndsWithNewline) {
          w.add('\n');
        }
      }
      const isChildRules = n.type === 'Rules';
      const isRulesetOrAtRule = n.type === 'Ruleset' || n.type === 'AtRule';
      // Add indentation only for simple nodes (declarations, etc.)
      // Ruleset and AtRule nodes indent themselves in renderOpening
      if (!isChildRules && !isRulesetOrAtRule && depth !== 0) {
        w.add(space);
      }

      // Emit directly to preserve source map segments
      // For child Rules nodes, pass the same depth (don't increment depth)
      // Rules nodes inside Rules nodes are at the same level
      const childOptions = isChildRules ? { ...options, depth } : { ...options, depth };
      let rule = w.capture(() => n.toTrimmedString(childOptions));
      w.add(rule, n); // Pass node as origin to preserve location info
      if (n.requiredSemi && n.options.semi !== false) {
        w.add(';', n);
      }
    }
  }

  override toTrimmedString(options?: PrintOptions) {
    options = getPrintOptions(options);
    const w = options.writer!;
    const mark = w.mark();
    this._emitRulesBody(options);
    return w.getSince(mark);
  }

  /** All rules, with nested rules flattened */
  flatRules(visibleOnly: boolean = false) {
    const finalRules: Node[] = [];
    const iterateRules = (rules: Rules) => {
      for (let n of rules.value) {
        if (isNode(n, 'Rules')) {
          iterateRules(n);
          continue;
        }
        if (!visibleOnly || n.visible || n.fullRender) {
          finalRules.push(n);
        }
      }
    };
    iterateRules(this);
    return finalRules;
  }

  visibleRules() {
    return this.value.filter(n => n.visible);
  }

  /**
   * Return an object representation of a ruleset
   */
  toObject(convertToPrimitives: true): Record<string, string | number | boolean>;
  toObject(convertToPrimitives: false): Record<string, Node>;
  toObject(convertToPrimitives?: boolean): Record<string, string | number  | boolean | Node>;
  toObject(convertToPrimitives: boolean = true): Record<string, string | number | boolean | Node> {
    let output = new Map<string, boolean | string | number | Node>();
    const iterateRules = (rules: Rules) => {
      for (let n of rules.value) {
        if (isNode(n, 'Declaration')) {
          let { name, value, important } = n.value;
          if (convertToPrimitives) {
            let primitive = value.valueOf();
            let outputValue = important ? `${primitive} ${important}` : primitive;
            if (outputValue === undefined) {
              continue;
            }
            output.set(name.toString(), outputValue);
          } else {
            let outputValue = important ? new Sequence([n, important]) : n;
            output.set(name.toString(), outputValue);
          }
        } else if (n instanceof Rules) {
          iterateRules(n);
        }
      }
    };
    iterateRules(this as unknown as Rules);
    return Object.fromEntries(output);
  }

  /** @todo - Refactor? */
  _rulesSet: RulesEntry[] | undefined;
  get rulesSet(): RulesEntry[] {
    return (this._rulesSet ??= []);
  }

  registerNode(node: Node, options?: Record<string, any>, context?: Context) {
    if (isNode(node, 'Rules')) {
      // Use options if provided, otherwise use node's settings, otherwise empty
      // Then merge with node's settings to preserve any values not in options
      let optionsVisibility = options?.rulesVisibility;
      let nodeVisibility = node.options.rulesVisibility ?? {};
      let rulesVisibility = optionsVisibility
        ? { ...nodeVisibility, ...optionsVisibility }
        : nodeVisibility;

      /** Only Declaration and Ruleset are public by default.
       * VarDeclaration visibility should be set by the parser (optional for Less, private for Jess/Sass).
       * Mixin visibility should be set by the parser.
       */
      rulesVisibility.Declaration ??= 'public';
      rulesVisibility.Ruleset ??= 'public';

      /** Either one set as readonly will win */
      let readonly = Boolean(options?.readonly || node.options.readonly);
      this.rulesSet.push({
        node,
        rulesVisibility,
        readonly
      });

      // Note: Rulesets from imported Rules are registered in treeRoot's registry
      // after evaluation completes (in evalNode), when treeRoot is guaranteed to be set
    } else if (isNode(node, 'Declaration')) {
      /**
       * setDefined works like Sass's !default flag - it finds the original variable
       * declaration and inserts a new declaration at the same rules level as the
       * found variable, but before the current nested node.
       */
      if (node.options?.setDefined) {
        // Skip setDefined logic if we're currently indexing to avoid recursive calls
        if (this._indexing) {
          // We'll handle setDefined after indexing is complete
          return;
        }

        let key = node.value.name?.toString();
        /** Don't set within sibling rules */
        let opts: Registries.FindOptions = {};
        opts.searchParents = true;
        // Don't use start when searching parents - we want to find variables in parent regardless of position
        // start is only relevant for finding variables before the current node in the same Rules
        opts.start = undefined;
        // node.type is 'VarDeclaration' or 'Declaration', use it directly as filterType
        let result = this.find('declaration', key, node.type as 'VarDeclaration' | 'Declaration', opts);
        if (result) {
          if (result.options?.readonly || opts.readonly) {
            throw new ReferenceError(`"${key}" is readonly`);
          }

          // Find the Rules node that contains the found declaration
          let foundRules: Rules | undefined = result.parent as Rules;

          if (!foundRules) {
            throw new Error(`Could not find parent Rules for declaration '${key}'`);
          }

          // Create a new declaration with the same name but our value
          const newDeclaration = node.copy();
          newDeclaration.options = { ...newDeclaration.options };
          newDeclaration.options.setDefined = undefined; // Remove setDefined flag

          // Adopt the new declaration to the found Rules
          foundRules.adopt(newDeclaration);

          // Add to the value array AFTER the found declaration
          // This ensures it shadows the original and is evaluated after it
          const foundIndex = foundRules.value.indexOf(result);
          if (foundIndex !== -1) {
            foundRules.value.splice(foundIndex + 1, 0, newDeclaration);
          } else {
            // If not found in array, add at the beginning
            foundRules.value.unshift(newDeclaration);
          }

          // Register it via registerNode to ensure it's properly indexed
          // Note: registerNode will call register('declaration', ...) which adds to registry
          // We skip setDefined processing since we already removed the flag
          foundRules.registerNode(newDeclaration);
        } else {
          throw new ReferenceError(`"${key}" is not defined`);
        }
      }

      this.register('declaration', node);
    } else if (isNode(node, 'Ruleset')) {
      // Register to 'mixin' for mixin calls
      // Always register - guard filtering happens at call time in getFunctionFromMixins
      // Note: 'ruleset' registration for extends now happens in Ruleset.preEval to the extend root's registry
      this.register('mixin', node);
    } else if (isNode(node, 'Mixin')) {
      this.register('mixin', node);
    }
  }

  push(...nodes: Node[]) {
    for (let node of nodes) {
      this.adopt(node);
      this.value.push(node);
      this.registerNode(node);
    }
  }

  at(index: number) {
    return atIndex(this.value, index);
  }

  /**
   * This traverses deeply to visit all nodes, but indexes locally.
   */
  override preEval(context: Context) {
    if (!this.preEvaluated) {
      // #region agent log
      agentBootLog(context, 'rules.ts:preEval', 'rules-preEval-enter', {
        len: Array.isArray(this.value) ? this.value.length : null,
        preEvaluated: !!this.preEvaluated
      });
      // #endregion
      context.depth++;
      let rules = this.maybeClone(context);
      rules.preEvaluated = true;
      // Save current context and set up new context for variable lookups during preEval
      const saved = this._snapshotContext(context);
      this._setupContextForRules(context, rules);

      // Set context.root early if this is the main root
      const isMainRoot = !context.root;
      if (isMainRoot) {
        context.root = rules;
      }

      /**
       * I think maybe we can just set the index to the actual order?
       */
      for (let i = 0; i < rules.value.length; i++) {
        let n = rules.value[i]!;
        n.index = i;
      }
      // Preserve parent when cloning - if this Rules is inside a ruleset, maintain the parent relationship
      if (this.parent && !rules.parent) {
        this.parent.adopt(rules);
      }

      // Set context.root if not already set (needed for preEval visitors)
      if (!context.root) {
        context.root = rules;
      }

      // Register main root as extend root if this is the root (needed for extends in preEval)
      // Check rules === context.root at registration time (not using stale isMainRoot)
      if (rules === context.root && !context.extendRoots.root) {
        context.extendRoots.registerRoot(rules);
        context.extendRoots.pushExtendRoot(rules);
      }

      // Multi-pass registration system for handling interpolated names
      // #region agent log
      agentBootLog(context, 'rules.ts:preEval', 'rules-preEval-before-multipass', {
        len: Array.isArray(rules.value) ? rules.value.length : null
      });
      // #endregion
      const mp = this._multiPassPreEval(rules, context, saved);
      // #region agent log
      if (!isThenable(mp)) {
        agentBootLog(context, 'rules.ts:preEval', 'rules-preEval-exit-sync', {});
      }
      // #endregion
      return mp;
    }
    return this;
  }

  /**
   * Multi-pass preEval system to handle interpolated names and dependencies
   */
  private _multiPassPreEval(rules: Rules, context: Context, saved: any): MaybePromise<this> {
    // First pass: Only register nodes with static names
    const staticNodes: Node[] = [];
    const dynamicNodes: Node[] = [];
    // #region agent log
    agentBootLog(context, 'rules.ts:_multiPassPreEval', 'multipass-enter', {
      total: Array.isArray(rules.value) ? rules.value.length : null
    });
    // #endregion

    // Process each node with static name, handling both sync and async preEval
    const processResult = serialForEach(rules.value, (node, index) => {
      // #region agent log
      agentBootLog(context, 'rules.ts:_multiPassPreEval', 'multipass-node', {
        index,
        type: node.type,
        hasStaticName: this._hasStaticName(node)
      });
      // #endregion
      // Check if node has a static name (can be registered immediately)
      if (node.type === 'Any' && node.options.role === 'charset') {
        /** Special case where we register the charset node immediately */
        rules.value[index] = (node as Any).preEval(context);
        return;
      }
      if (this._hasStaticName(node)) {
        // Pre-evaluate nodes with static names before registration
        // This ensures selectors are evaluated and keySets are available for rulesets
        // #region agent log
        agentBootLog(context, 'rules.ts:_multiPassPreEval', 'multipass-node-preEval-enter', {
          index,
          type: node.type
        });
        // #endregion
        const preEvald = node.preEval(context);
        if (isThenable(preEvald)) {
          return (preEvald as Promise<Node>).then((preEvaldNode) => {
            rules.value[index] = preEvaldNode;
            // After async preEval, check if it still has a static name
            if (this._hasStaticName(preEvaldNode)) {
              staticNodes.push(preEvaldNode);
              this._registerNodeIfEligible(rules, preEvaldNode, context);
            } else {
              dynamicNodes.push(preEvaldNode);
            }
            // #region agent log
            agentBootLog(context, 'rules.ts:_multiPassPreEval', 'multipass-node-preEval-exit-async', {
              index,
              type: preEvaldNode.type,
              hasStaticName: this._hasStaticName(preEvaldNode)
            });
            // #endregion
          });
        }
        // #region agent log
        agentBootLog(context, 'rules.ts:_multiPassPreEval', 'multipass-node-preEval-exit', {
          index,
          type: (preEvald as Node).type
        });
        // #endregion
        rules.value[index] = preEvald as Node;
        const nodeToRegister = preEvald as Node;
        staticNodes.push(nodeToRegister);
        this._registerNodeIfEligible(rules, nodeToRegister, context);
      } else {
        dynamicNodes.push(node);
      }
    });

    const finish = () => {
      // #region agent log
      agentBootLog(context, 'rules.ts:_multiPassPreEval', 'multipass-finish', {
        dynamicCount: dynamicNodes.length
      });
      // #endregion
      // If no dynamic nodes, we're done
      if (dynamicNodes.length === 0) {
        // Restore context after preEval is complete
        context.rulesContext = saved.rulesContext;
        context.treeRoot = saved.treeRoot;
        // Only restore context.root if saved.root is defined (not the outermost root)
        // If saved.root is undefined, it means we're at the outermost level, so keep context.root as is
        if (saved.root !== undefined) {
          context.root = saved.root;
        }
        return rules as this;
      }
      // Multi-pass resolution of dynamic nodes
      return this._resolveDynamicNodes(rules, context, saved, dynamicNodes);
    };

    if (isThenable(processResult)) {
      return (processResult as Promise<void>).then(() => finish());
    }
    return finish();
  }

  /**
   * Helper to check if a value is static (either a Node with F_STATIC flag or a primitive value)
   */
  private _isStatic(value: any): boolean {
    if (value && typeof value.hasFlag === 'function') {
      return value.hasFlag(F_STATIC);
    }
    // Primitive values (strings, numbers, etc.) are considered static
    return true;
  }

  /**
   * Check if a node has a static name that can be registered immediately
   */
  private _hasStaticName(node: Node): boolean {
    if (isNode(node, 'VarDeclaration')) {
      const name = node.value.name;
      return this._isStatic(name);
    }
    if (isNode(node, 'Mixin')) {
      const name = node.value.name;
      return this._isStatic(name);
    }
    if (isNode(node, 'StyleImport')) {
      const path = node.value.path;
      return this._isStatic(path);
    }
    if (isNode(node, 'Ruleset')) {
      const selector = node.value.selector;
      // BasicSelector, CompoundSelector, ComplexSelector etc. are always static
      // Only Interpolated selectors need resolution
      if (isNode(selector, ['BasicSelector', 'CompoundSelector', 'ComplexSelector', 'SelectorList'])) {
        return true;
      }
      // After preEval, the selector should be resolved to static identifiers
      if (node.preEvaluated) {
        return true;
      }
      // Check F_STATIC flag for other selector types
      if (selector && 'hasFlag' in selector && typeof selector.hasFlag === 'function') {
        return selector.hasFlag(F_STATIC);
      }
      return false;
    }
    // For other node types, assume they can be registered if they have static names
    return node.hasFlag(F_STATIC);
  }

  /**
   * Register a node if it's eligible for registration
   */
  private _registerNodeIfEligible(rules: Rules, node: Node, context: Context) {
    if (isNode(node, 'Declaration')) {
      rules.registerNode(node);
    } else if (isNode(node, 'Mixin')) {
      rules.registerNode(node);
    } else if (isNode(node, 'Ruleset')) {
      // registerNode handles both 'mixin' and 'ruleset' registries
      rules.registerNode(node);
    }
  }

  /**
   * Multi-pass resolution of dynamic nodes with interpolated names
   */
  private _resolveDynamicNodes(rules: Rules, context: Context, saved: any, dynamicNodes: Node[]): MaybePromise<this> {
    const unresolvedNodes: Node[] = [...dynamicNodes];
    const resolvedNodes: Node[] = [];
    let firstError: Error | undefined;
    let resolutionAttempts = 0;
    const MAX_RESOLUTION_ATTEMPTS = 5;

    const attemptResolution = (): MaybePromise<this> => {
      resolutionAttempts++;
      // #region agent log
      agentBootLog(context, 'rules.ts:_resolveDynamicNodes', 'dynamic-attempt', {
        attempt: resolutionAttempts,
        unresolved: unresolvedNodes.length,
        resolved: resolvedNodes.length
      });
      // #endregion
      if (resolutionAttempts > MAX_RESOLUTION_ATTEMPTS) {
        throw new Error(`Could not resolve node.`);
      }
      const stillUnresolved: Node[] = [];
      let madeProgress = false;

      for (const node of unresolvedNodes) {
        try {
          // Try to preEval the node
          const result = node.preEval(context);

          if (isThenable(result)) {
            // Handle async preEval
            return (result as Promise<Node>).then((resolvedNode) => {
              // Register rulesets after preEval regardless of static name
              if (resolvedNode.type === 'Ruleset') {
                // registerNode handles both 'mixin' and 'ruleset' registries
                rules.registerNode(resolvedNode);
              }
              if (this._hasStaticName(resolvedNode)) {
                resolvedNodes.push(resolvedNode);
                this._registerNodeIfEligible(rules, resolvedNode, context);
                madeProgress = true;
              } else {
                stillUnresolved.push(resolvedNode);
              }
              return attemptResolution();
            });
          }

          // Register rulesets after preEval regardless of static name
          if (result.type === 'Ruleset') {
            // registerNode handles both 'mixin' and 'ruleset' registries
            rules.registerNode(result);
          }

          // Check if the node now has a static name
          if (this._hasStaticName(result)) {
            resolvedNodes.push(result);
            this._registerNodeIfEligible(rules, result, context);
            madeProgress = true;
          } else {
            stillUnresolved.push(result);
          }
        } catch (error) {
          if (!firstError) {
            firstError = error as Error;
          }
          stillUnresolved.push(node);
        }
      }

      // Update the rules with resolved nodes
      for (let i = 0; i < rules.value.length; i++) {
        const node = rules.value[i]!;
        const resolvedNode = resolvedNodes.find(n => n.index === node.index);
        if (resolvedNode && resolvedNode !== node) {
          rules.value[i] = resolvedNode.inherit(node);
          rules.adopt(resolvedNode);
        }
      }

      // If we made progress, try again
      if (madeProgress && stillUnresolved.length > 0) {
        unresolvedNodes.length = 0;
        unresolvedNodes.push(...stillUnresolved);
        return attemptResolution();
      }

      // If we still have unresolved nodes and we're done with rules evaluation, throw the first error
      if (stillUnresolved.length > 0 && firstError) {
        throw firstError;
      }

      // Restore context after preEval is complete
      context.rulesContext = saved.rulesContext;
      context.treeRoot = saved.treeRoot;
      // Only restore context.root if saved.root is defined (not the outermost root)
      // If saved.root is undefined, it means we're at the outermost level, so keep context.root as is
      if (saved.root !== undefined) {
        context.root = saved.root;
      }

      return rules as this;
    };

    return attemptResolution();
  }

  /**
   * Helper method to continue preEval'ing remaining children after an async preEval.
   */
  private _preEvalRemainingChildren(rules: Rules, context: Context, startIndex: number, saved?: any): MaybePromise<this> {
    for (let i = startIndex; i < rules.value.length; i++) {
      const node = rules.value[i]!;

      // Always call preEval to ensure deep traversal and name resolution
      const result = node.preEval(context);
      if (isThenable(result)) {
        // Handle async preEval by returning a promise that resolves after all children
        return result.then((resolvedNode) => {
          // Update the node if preEval returned a different instance
          if (resolvedNode !== node) {
            rules.value[i] = resolvedNode;
            rules.adopt(resolvedNode);
          }

          // Register the node after preEval (name resolution) if not already registered
          if (!isNode(node, 'VarDeclaration')) {
            rules.registerNode(resolvedNode);
          }

          // Continue with the rest of the children
          return this._preEvalRemainingChildren(rules, context, i + 1, saved);
        });
      }

      // Update the node if preEval returned a different instance
      if (result !== node) {
        rules.value[i] = result;
        rules.adopt(result);
      }

      // Register the node after preEval (name resolution) if not already registered
      if (!isNode(node, 'VarDeclaration')) {
        rules.registerNode(result);
      }
    }

    // Restore context after preEval is complete (for async case)
    if (saved) {
      context.rulesContext = saved.rulesContext;
      context.treeRoot = saved.treeRoot;
      // Only restore context.root if saved.root is defined (not the outermost root)
      // If saved.root is undefined, it means we're at the outermost level, so keep context.root as is
      if (saved.root !== undefined) {
        context.root = saved.root;
      }
    }
    return rules as this;
  }

  /** Save current context roots to restore later */
  private _snapshotContext(context: Context) {
    return {
      rulesContext: context.rulesContext,
      treeContext: context.treeContext,
      treeRoot: context.treeRoot,
      root: context.root,
      extendRootStackLength: context.extendRoots.extendRootStack.length
    } as const;
  }

  /** Setup context for evaluating these rules */
  private _setupContextForRules(context: Context, rules: Rules) {
    const treeContext = context.treeContext;
    // Only switch treeContext if the rules have one AND it's different
    // Dynamically created Rules (e.g., mixin parameter wrappers) may not have treeContext
    // and we don't want to lose leakyRules and other settings
    // IMPORTANT: Check _treeContext (private field) not treeContext (getter that lazily creates)
    const rulesTreeContext = (rules as any)._treeContext as TreeContext | undefined;
    if (rulesTreeContext && (!treeContext || treeContext !== rulesTreeContext)) {
      context.allRoots.push(rules);
      context.treeContext = rulesTreeContext;
      context.treeRoot = rules;
    }
    // Always set root if not set - needed for extends to work with API-created Rules
    context.root ??= rules;
    context.rulesContext = rules;
  }

  /** Build the evaluation queue partitioned by priority */
  private _buildEvalQueue(rules: Rules): EvalQueueMap {
    let evalQueue: EvalQueueMap = new Map();
    for (let item of rules) {
      let [idx, rule] = item;
      let priority = NodeTypeToPriority.get(rule.type) ?? Priority.None;
      let queue = evalQueue.get(priority) ?? [];
      queue.push(item as [number, Node]);
      evalQueue.set(priority, queue);
    }
    return evalQueue;
  }

  /** Evaluate the built queues in priority order */
  private _evaluateQueue(rules: Rules, evalQueue: EvalQueueMap, context: Context): MaybePromise<boolean> {
    let rulesToHoist = false;
    // Track nodes that have been retried to avoid infinite loops
    const retriedNodes = new Set<Node>();

    // #region agent log
    let __agentQueueLogCount = 0;
    const agentQueueLog = (message: string, data: Record<string, unknown>) => {
      if (process.env.DEBUG_EXTEND_BOOT !== 'true') return;
      if (__agentQueueLogCount++ > 250) return;
      const filePath = context.treeContext?.file?.fullPath
        || (context.treeContext?.file?.path && context.treeContext?.file?.name
          ? `${context.treeContext.file.path}/${context.treeContext.file.name}`
          : context.treeContext?.file?.path)
        || '';
      if (typeof filePath === 'string' && !filePath.includes('tests-unit/extend-selector')) return;
      syncLog({
        sessionId: 'debug-session',
        runId: process.env.DEBUG_RUN_ID || 'pre-fix',
        hypothesisId: 'H7',
        location: 'rules.ts:_evaluateQueue',
        message,
        data,
        timestamp: Date.now()
      });
    };
    // #endregion

    const priorities: Priority[] = Array.from({ length: Priority.Highest + 1 }).map((_, i) => (Priority.Highest - i) as Priority);
    const phaseRun = serialForEach(priorities, (p: Priority) => {
      const queue = evalQueue.get(p);
      if (!queue) {
        return;
      }
      // #region agent log
      agentRulesLog(context, 'rules.ts:_evaluateQueue', 'priority-start', {
        priority: p,
        queueLen: queue.length,
        retriedCount: retriedNodes.size
      });
      // #endregion
      // #region agent log
      agentQueueLog('priority-start', {
        priority: p,
        queueLen: queue.length,
        retriedCount: retriedNodes.size
      });
      // #endregion
      const entries: Array<[number, [number, Node]]> = Array.from(queue.entries()) as any;
      const innerResultPromise = serialForEach(entries, ([q, item]: [number, [number, Node]]): MaybePromise<void | undefined> => {
        const [idx, rule] = item;

        /**
         * Var declarations have late evaluation, so they are skipped.
         * (Meaning: they are not evaluated until they are referenced.)
         */
        if (isNode(rule, 'VarDeclaration')) {
          return;
        }

        // Check if this node should be skipped (already moved to retry queue)
        // BUT: if we're at Priority.None, we should process it even if it was retried
        // because this is the retry attempt
        if (retriedNodes.has(rule) && p > Priority.None) {
          return;
        }

        // #region agent log
        agentRulesLog(context, 'rules.ts:_evaluateQueue', 'node-eval-enter', {
          priority: p,
          idx,
          q,
          type: rule.type,
          retried: retriedNodes.has(rule)
        });
        // #endregion
        // #region agent log
        const t0 = Date.now();
        agentQueueLog('node-eval-enter', {
          priority: p,
          idx,
          q,
          type: rule.type,
          ctor: (rule as any)?.constructor?.name ?? null,
          retried: retriedNodes.has(rule)
        });
        // #endregion

        const tryStepResult: () => MaybePromise<Node> =
        tryStep(() => rule.eval(context), {
          onError(error) {
            // At Priority.None, all errors should be thrown - no more retries
            if (p === Priority.None) {
              throw error;
            }
            // If evaluation failed and we haven't retried this node yet,
            // retry at Priority.None
            if (!retriedNodes.has(rule)) {
              retriedNodes.add(rule);
              // Move to lowest priority queue for retry
              const lowQueue = evalQueue.get(Priority.None) || [];
              lowQueue.push([idx, rule]);
              evalQueue.set(Priority.None, lowQueue);
              // Don't throw - let tryStep return the fallback so processing continues
              return;
            }
            // Already retried and still failing - rethrow
            throw error;
          },
          // Always rethrow errors from onError
          rethrow: true,
          // Return the original rule node as fallback when we skip processing (for retry)
          fallback: rule
        }) as () => MaybePromise<Node>;
        const stepResult = pipe(
          tryStepResult,
          (result: Node | undefined) => {
            // If result is undefined (onError returned without throwing), skip processing
            if (result === undefined) {
              return;
            }
            // Apply the result
            if (result !== rule) {
              rules.value[idx] = result;
              queue[q] = [idx, result];
              // If a StyleImport evaluated to Rules, register them in the parent's _rulesSet
              // so variables from the import can be found by the parent
              // Also register Rules from Call results (mixin calls) in the same way
              if (isNode(result, 'Rules')) {
                // Set the index of the imported Rules to the StyleImport's index
                // so we can compare Rules indices when determining which variable was declared later
                result.index = idx;
                rules.adopt(result);
                rules.registerNode(result, {
                  rulesVisibility: result.options.rulesVisibility,
                  readonly: result.options.readonly
                }, context);
              } else {
                // For non-Rules results, adopt them to set up parent chain
                rules.adopt(result);
              }
            }
            if (result.hoistToRoot) {
              rulesToHoist = true;
            }
            // #region agent log
            agentQueueLog('node-eval-exit', {
              priority: p,
              idx,
              q,
              type: rule.type,
              durationMs: Date.now() - t0
            });
            // #endregion
            return;
          }
        );
        // #region agent log
        if (isThenable(stepResult)) {
          return (stepResult as Promise<unknown>).catch((error) => {
            agentQueueLog('node-eval-error', {
              priority: p,
              idx,
              q,
              type: rule.type,
              durationMs: Date.now() - t0,
              err: error ? String((error as any).message ?? error) : 'unknown'
            });
            throw error;
          }) as any;
        }
        // #endregion
        // If stepResult is a thenable, propagate any errors
        if (isThenable(stepResult)) {
          return stepResult;
        }
        return;
      });
      // Return innerResultPromise - if it's a rejected promise, serialForEach should propagate it
      return innerResultPromise;
    });

    if (isThenable(phaseRun)) {
      return (phaseRun as Promise<void>).then(() => {
        return rulesToHoist;
      }).catch((error) => {
        throw error;
      });
    }
    return rulesToHoist;
  }

  override evalNode(context: Context): MaybePromise<this> {
    const saved = this._snapshotContext(context);
    context.rulesEvalStack.push(this.sourceNode as Rules);
    const pipeResult = pipe(
      () => {
        this._setupContextForRules(context, this);
        // Extend root should already be registered in preEval, but ensure it's on the stack
        // (it might have been popped if this is a nested Rules evaluation)
        const isMainRoot = this === context.root;
        if (isMainRoot && context.extendRoots.extendRootStack.length === 0) {
          context.extendRoots.pushExtendRoot(this);
        }
        // Synchronous preEval
        const rules = this;
        if (rules.evaluated) {
          return { rules, rulesToHoist: false };
        }
        const evalQueue = this._buildEvalQueue(rules);
        // #region agent log
        const qSizes: Record<string, number> = {};
        for (const [p, q] of evalQueue.entries()) {
          qSizes[String(p)] = q.length;
        }
        agentRulesLog(context, 'rules.ts:evalNode', 'queue-built', {
          evaluated: !!rules.evaluated,
          total: rules.value.length,
          qSizes
        });
        // #endregion
        const maybeHoist = this._evaluateQueue(rules, evalQueue, context);
        if (isThenable(maybeHoist)) {
          return (maybeHoist as Promise<boolean>).then((rulesToHoist) => {
            return { rules, rulesToHoist };
          }).catch((error) => {
            throw error;
          });
        }
        return { rules, rulesToHoist: maybeHoist as boolean };
      },
      ({ rules }: { rules: Rules; rulesToHoist: boolean }) => {
        // Note: Rulesets from imported Rules are already registered to their own treeRoot
        // during preEval when the imported Rules node is evaluated. The extend search
        // loops through allRoots, so it should find them. The _searchRulesChildrenForRulesets
        // method in RulesetRegistry also searches imported Rules' registries.

        // After all evaluation stages, check if any variables in the current Rules
        // shadow readonly variables from imported Rules (compose type) at the same level
        // Only check direct children of the Rules node, not nested variables (e.g., inside rulesets)
        if (rules.rulesSet.length > 0) {
          let currentRegistry = rules.getRegistry('declaration');
          currentRegistry.indexPendingItems();
          for (const entry of rules.rulesSet) {
            if (entry.readonly) {
              let importedRegistry = entry.node.getRegistry('declaration');
              importedRegistry.indexPendingItems();
              for (const [key, declarations] of importedRegistry.index) {
                for (const decl of declarations) {
                  if (isNode(decl, 'VarDeclaration')) {
                    // Check if a variable with this name exists in the current Rules' registry
                    let currentDeclarations = currentRegistry.index.get(key);
                    if (currentDeclarations) {
                      for (const currentDecl of currentDeclarations) {
                        if (isNode(currentDecl, 'VarDeclaration') && !currentDecl.options?.setDefined) {
                          // Only throw if the variable is a direct child of the Rules node (same level)
                          // Nested variables (e.g., inside rulesets) are allowed to shadow
                          if (currentDecl.parent === rules) {
                            throw new ReferenceError(`"${key}" is readonly`);
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }

        // Check if we're at the outermost level BEFORE restoring context
        // Only process extends at the TRUE outermost root (context.root)
        // This ensures extends are processed AFTER all evaluation completes,
        // including imports and nested Rules
        const isOutermost = rules === context.root;

        if (isOutermost) {
          // #region agent log
          agentRulesLog(context, 'rules.ts:eval', 'processExtends-enter', {
            extendsCount: context.extends.length
          });
          // #endregion
          // Process all registered extends using the extend roots registry system
          processExtends(context);
          // #region agent log
          agentRulesLog(context, 'rules.ts:eval', 'processExtends-exit', {
            extendsCount: context.extends.length
          });
          // #endregion
        }
        /** Restore contexts */
        context.rulesContext = saved.rulesContext;
        // Only restore context.treeRoot if saved.treeRoot is defined and we're not at the outermost level
        // If saved.treeRoot is undefined, it means we're at the outermost level, so keep context.treeRoot as is
        // This ensures extends evaluated during selector evaluation can still access the correct treeRoot
        if (saved.treeRoot !== undefined && !isOutermost) {
          context.treeRoot = saved.treeRoot;
        }
        // Only restore context.root if we're not at the outermost level (where it was originally set)
        // If saved.root is undefined, it means we're at the outermost level, so keep context.root as is
        if (saved.root !== undefined && !isOutermost) {
          context.root = saved.root;
        }
        // Restore extend root stack to its original length (if we're not the main root)
        // The main root manages its own push/pop, but nested Rules should restore the stack
        if (!isOutermost && saved.extendRootStackLength !== undefined) {
          const currentLength = context.extendRoots.extendRootStack.length;
          if (currentLength > saved.extendRootStackLength) {
            // Pop any extend roots that were pushed during this Rules evaluation
            while (context.extendRoots.extendRootStack.length > saved.extendRootStackLength) {
              context.extendRoots.popExtendRoot();
            }
          }
        }
        // Pop extend root if we pushed it (check if this is still the root)
        if (rules === context.root) {
          context.extendRoots.popExtendRoot();
        }
        context.rulesEvalStack.pop();
        context.depth--;
        return rules;
      }
    );
    return pipeResult as MaybePromise<this>;
  }
}

export const rules = defineType(Rules, 'Rules');

type EvalQueueMap = Map<Priority, Array<[number, Node]>>;

/**
 * @todo - Will need lots of massaging, to resolve things like
 * mixins which rely on variables which have interpolated names,
 * and variables with interpolated names that rely on mixins.
 *
 * @note - Registration of declaration names and mixins / selectors
 * should have already happened in pre-eval.
 */
const NodeTypeToPriority = new Map([
  /** First, resolve imports */
  ['StyleImport', Priority.Highest],
  /** Then, resolve calls */
  ['Call', Priority.High],
  /** Then, resolve declarations */
  ['VarDeclaration', Priority.Medium],
  ['Declaration', Priority.Medium],
  /** Then... */
  ['Mixin', Priority.Low],
  ['Ruleset', Priority.Low],
  /** Extend should evaluate at the same priority as Ruleset to ensure it evaluates before nested rulesets */
  ['Extend', Priority.Low]
  /** Then, everything else? */
]);

// const TypeToNodeType = new Map([
//   ['Mixin', NodeType.MIXIN],
//   ['Ruleset', NodeType.RULESET],
//   ['Declaration', NodeType.PROPERTY],
//   ['VarDeclaration', NodeType.VARIABLE],
//   ['Rules', NodeType.RULES]
// ])

// export const enum NodeTypeIndex {
//   NONE             = 0b000000,
//   MIXIN            = 0b000001,
//   RULESET          = 0b000010,
//   MIXIN_OR_RULESET = 0b000011,
//   PROPERTY         = 0b000100,
//   VARIABLE         = 0b001000,
//   VAR_OR_PROP      = 0b001100,
//   /**
//    * Variables and mixins can leak
//   */
//   LEAKY_RULES      = 0b010000,
//   /** @note - Properties and rulesets are always visible. */
//   PRIVATE_RULES    = 0b100000,
//   RULES            = 0b110000
// }

// type IndexKey = `${NodeType}${string}`

interface RulesEntry {
  node: Rules;
  rulesVisibility?: RulesOptions['rulesVisibility'];
  /**
   * These are from use, from, and import statements. Can't be assigned with $$
   * (verify that this is not possible with SCSS).
   */
  readonly?: boolean;
}

/**
 * Right now, the only nodes that can be registered to the scope for lookups
 */
// type ScopeNodes = Declaration | VarDeclaration | Mixin | Ruleset | Rules
export type MixinEntry = Mixin | Ruleset;

/**
 * Returns a plain JS function for calling a set of mixins
 *
 * This is in the same file as Rules to avoid circular dependencies.
 *
 * @note this will be called as a result after a mixin find is executed.
 */
export function getFunctionFromMixins(mixins: MixinEntry | MixinEntry[]) {
  let mixinArr = isArray(mixins) ? mixins : [mixins];
  /**
   * This will be called by a mixin call or by JavaScript
   *
   * @note - Mixins resolve to async functions because they
   * can contain dynamic imports.
   */
  async function returnFunc(this: unknown, ...args: any[]): Promise<Rules | Record<string, string>>;
  async function returnFunc(this: Context, ...args: any[]): Promise<Rules>;
  async function returnFunc(this: Context | unknown, ...args: any[]) {
    const mixinLength = mixinArr.length;
    let mixinCandidates: MixinEntry[] = [];
    let evalCandidates: MixinEntry[];
    // When called via callWithContext, 'this' is functionThis, not Context
    // We need to extract the context from functionThis or use a fallback
    let thisContext: Context;

    if (this instanceof Context) {
      thisContext = this;
    } else if (this && typeof this === 'object' && 'context' in this) {
      // This is functionThis from callWithContext
      thisContext = (this as any).context;
    } else {
      thisContext = new Context();
    }
    let caller = thisContext.caller;
    let sourceParent = caller?.value.name instanceof Node
      ? caller.value.name.sourceParent
      : caller?.sourceParent;

    let nodeArgs: Node[] = [];
    for (let arg of args) {
      /**
       * I think they should always be nodes?
       * But leaving this for future expansion.
       */
      if (isNode(arg)) {
        let evald = await arg.clonedEval(thisContext);
        evald.frozen = true;
        nodeArgs.push(evald);
      } else {
        nodeArgs.push(cast(arg));
      }
    }
    /**
     * Check named and positional arguments
     * against mixins, to see which ones match.
     * (Any mixin with a mis-match of
     * arguments fails.)
     */
    for (let i = 0; i < mixinLength; i++) {
      let mixin = mixinArr[i]!;
      let isPlainRule = isNode(mixin, 'Rules');
      let paramLength = isPlainRule ? 0 : (mixin as Mixin).value.params?.length ?? 0;
      if (!paramLength) {
        /** Exit early if args were passed in, but no args are possible */
        if (args.length) {
          continue;
        }
        mixinCandidates.push(mixin);
      } else {
        /** The mixin has parameters, so let's check args to see if there's a match */
        let params = (mixin as Mixin).value.params!.copy(true);
        let positions = params.length;
        let requiredPositions = 0;
        for (let param of params.value) {
          if (isNode(param, 'VarDeclaration')) {
            if (param.value.value instanceof Nil) {
              requiredPositions++;
            }
          } else if (isNode(param, 'Any') && param.options.role === 'property') {
            // Any with role: 'property' is a parameter without default (consistent with variable names)
            requiredPositions++;
          } else if (!isNode(param, 'Rest')) {
            requiredPositions++;
          }
        }
        let argPos = 0;
        let match = true;
        for (let i = 0; i < positions; i++) {
          let arg = nodeArgs[argPos];
          if (!arg) {
            continue;
          }
          let param: Node | undefined;
          let argValue: Node;
          if (isNode(arg, 'VarDeclaration')) {
            param = params.value.find(
              (p, i) => {
                if (isNode(p, 'VarDeclaration')) {
                  return p.value.name.valueOf() === arg.value.name.valueOf();
                }
                if (isNode(p, 'Any') && p.options.role === 'property') {
                  return p.valueOf() === arg.value.name.valueOf();
                }
                return false;
              }
            );
            if (param) {
              argValue = arg.value.value;
            } else {
              match = false;
              break;
            }
          } else {
            param = params.value[i];
            if (!param) {
              match = false;
              break;
            }

            argValue = arg;
          }
          if (!param) {
            match = false;
            break;
          }
          if (isNode(param, 'VarDeclaration')) {
            param.value.value = argValue;
          } else if (isNode(param, 'Any') && param.options.role === 'property') {
            // Convert Any with role: 'property' to VarDeclaration for registration
            const varDecl = new VarDeclaration({
              name: param as Any<'property'>,
              value: argValue
            });
            params.value[i] = varDecl;
          } else if (isNode(param, 'Rest')) {
            /** We assume that the rest args are values */
            let rest = nodeArgs.slice(argPos);
            /** Create a new variable with the rest name */
            params.value[i] = new VarDeclaration({
              name: new Any(param.value ? `${param.value}` : `rest${i}`, { role: 'property' }) as Any<'property'>,
              value: new Sequence(rest)
            });
            /** Check a pattern-matching node */
          } else {
            if (param.compare(argValue) !== 0) {
              /** This mixin is not a match */
              match = false;
              break;
            }
          }
          argPos++;
        }
        /**
         * Now we can check remaining positional matches
         * against the remaining parameters.
         */
        if (argPos < requiredPositions) {
          /** This mixin is not a match */
          continue;
        }
        if (match) {
          /** Make a shallow copy to attach our resolved params (w/ args) */
          let originalMixin = mixin;
          mixin = mixin.copy();
          originalMixin.parent!.adopt(mixin);
          (mixin as Mixin).value.params = params;
          mixinCandidates.push(mixin);
        }
      }
    }
    /**
     * Alright, we have mixin candidates (mixins that match
     * by arity, pattern, and/or named arguments), now what?
     *
     * First, let's make an evaluation order that evaluates
     * default guards last.
     */
    let hasDefault = false;
    evalCandidates = mixinCandidates
      .filter((candidate) => {
        const inStack = thisContext.rulesEvalStack.includes(candidate.value.rules.sourceNode as Rules);
        return !inStack;
      })
      .map<MixinEntry>(
        (candidate) => {
          let isDefault = candidate.options?.hasDefault;
          if (isDefault) {
            if (hasDefault) {
              throw new Error('Ambiguous use of default guard found');
            }
            hasDefault = true;
          }
          return candidate;
        });

    if (hasDefault) {
      /** There is a default guard, so sort candidates */
      evalCandidates = evalCandidates.slice(0).sort((a, b) => {
        let aDefault = a.options?.hasDefault;
        let bDefault = b.options?.hasDefault;
        /** No guard (or is just a plain ruleset) */
        if (!aDefault && !bDefault) {
          return 0;
        }

        if (!aDefault) {
          return 1;
        }
        if (!bDefault) {
          return -1;
        }
        return 0;
      });
    }

    if (evalCandidates.length === 0) {
      throw new ReferenceError('No matching mixins found.');
    }

    /**
     * Now we have a set of mixins that can return rulesets,
     * but first we need to create a new scope for each mixin,
     * and create variable declarations for each parameter.
     */
    let hasMatch = false;
    let outputRules: Rules[] = [];

    for (let candidate of evalCandidates) {
      if (isNode(candidate, 'Ruleset')) {
        // For Rulesets, guard was already evaluated at definition time in Ruleset.evalNode
        // guard === undefined means passed, guard instanceof Nil means failed
        const rulesetGuard = (candidate as Ruleset).value.guard;
        if (rulesetGuard instanceof Nil) {
          // Guard failed at definition time - skip this ruleset
          continue;
        }
        let rules = (candidate as Ruleset).value.rules.copy(true);
        /** Adopt for lookup, then adopt for sorting */
        candidate.parent!.adopt(rules);
        rules.sourceParent = candidate.sourceParent ?? sourceParent;
        let originalContext = thisContext.rulesContext;
        thisContext.rulesContext = rules;
        rules = await rules.eval(thisContext);
        thisContext.rulesContext = originalContext;
        candidate.parent!.adopt(rules);
        // Rules should have index from eval, but ensure it matches candidate for sorting
        rules.index = candidate.index;
        hasMatch = true;
        // Skip empty Rules (e.g., containing only invisible nodes like comments)
        // Mark output Rules as mixin output - accessible only when lookup has a target
        rules.options.isMixinOutput = true;
        outputRules.push(rules);
        continue;
      }
      let rules = candidate.value.rules;
      /** Create new rules, and add the candidate rules, to add to scope */
      rules = rules.copy(true);
      candidate.parent!.adopt(rules);
      rules.sourceParent = candidate.sourceParent ?? sourceParent;
      // Don't set index before evaluation - let evaluation assign the correct index
      /**
       * If we have params or a guard, we need to create a wrapper rules object,
       * so that the lookups of params and guard do not look at the cloned rules,
       * but instead look upwards / outwards.
       */
      let outerRules: Rules | undefined;

      /** Now we need to add our parameters, if any */
      let params = candidate.value.params;
      if (params) {
        outerRules = Rules.create([], {
          rulesVisibility: {
            Ruleset: 'public',
            Declaration: 'public',
            VarDeclaration: 'public',
            Mixin: 'public'
          }
        });
        candidate.parent!.adopt(outerRules);
        outerRules.index = candidate.index;

        for (let i = 0; i < params.value.length; i++) {
          let param = params.value[i]!;
          if (isNode(param, 'Rest')) {
            // Rest parameters need to be converted to VarDeclaration for registration
            // Auto-generate a name if Rest doesn't have one (Less allows unnamed rest params)
            let restName: string;
            if (typeof param.value === 'string') {
              restName = param.value;
            } else {
              // Auto-generate name: "rest", "rest1", "rest2", etc. based on position
              // Check if there are other rest params to avoid conflicts
              let restCount = 0;
              for (let j = 0; j < i; j++) {
                const p = params.value[j]!;
                if (isNode(p, 'Rest')) {
                  restCount++;
                }
              }
              restName = restCount === 0 ? 'rest' : `rest${restCount + 1}`;
            }

            // Convert Rest to VarDeclaration so it can be registered and referenced
            // The Rest's value (list of remaining arguments) was already set during matching
            // Ensure param.value is a Node (it should be a Sequence/List from spaced())
            const restValue = isNode(param.value)
              ? param.value
              : (param.value ? new Any(String(param.value)) : new Nil());
            const restVarDecl = new VarDeclaration({
              name: new Any(restName, { role: 'property' }),
              value: restValue
            }, { paramVar: true });

            // Replace Rest with VarDeclaration in params
            params.value[i] = restVarDecl;
            param = restVarDecl;
          }

          if (isNode(param, 'VarDeclaration')) {
            // Assign negative indices so they're conceptually "before" the rules and found first
            if (param.index === undefined) {
              // Use negative indices starting from -1, -2, etc. so they sort before regular rules
              param.index = -(i + 1);
            }
            param.removeFlag(F_VISIBLE);
            outerRules.push(param);
          }
          // Note: Any with role: 'property' should have been converted to VarDeclaration during matching
          // If we see one here, it's an error - params should all be VarDeclaration by now
        }
        let argumentsArgs: Node[] = [];
        rules.register('declaration', new VarDeclaration({
          name: new Any('arguments', { role: 'property' }),
          value: new List(argumentsArgs)
        }, { readonly: true }));

        /** Prevent re-parenting to arguments node */
        for (let p of params.value) {
          if (isNode(p, 'VarDeclaration')) {
            let innerValue = p.value.value;
            let innerValueClone = innerValue.clone(true, freezeChildren);
            innerValueClone.frozen = true;
            argumentsArgs.push(innerValueClone);
          } else if (isNode(p, 'Any') && p.options.role === 'property') {
            // Should have been converted, but handle just in case
            argumentsArgs.push(new Nil());
          } else {
            argumentsArgs.push(p);
          }
        }
      }

      /** Now we can evaluate our guards, if any */
      let guard: Condition | Bool | undefined = candidate.value.guard?.copy(true);
      let passes = true;
      let rulesContext = thisContext.rulesContext;
      // Call-time resolution is handled by the current context.rulesContext
      thisContext.rulesContext = outerRules ?? rules;
      if (guard) {
        outerRules ??= Rules.create([]);
        outerRules.adopt(guard);
        candidate.parent!.adopt(outerRules);
        /** Allow lookup on the inherited rules */
        passes = false;
        /** All nodes need context to be evaluated */
        thisContext.isDefault = !hasMatch;
        guard = await guard.eval(thisContext);
        /** The guard condition passed */
        if (guard.value) {
          passes = true;
        }
      }
      if (!passes) {
        continue;
      }
      let currentCall = thisContext.callStack.at(-1);
      // to prevent infinite loops (e.g., .recursion { .recursion(); })
      if (currentCall && thisContext.callMap.add(currentCall, params)) {
        // Recursive call detected - skip this candidate (don't add to outputRules)
        // This allows other candidates to still match
        continue;
      }

      try {
        let newRules: Rules;
        if (!outerRules) {
          candidate.parent!.adopt(rules);
          newRules = await rules.eval(thisContext);
        } else {
          outerRules.push(...rules.value);
          outerRules.options.rulesVisibility = rules.options.rulesVisibility;
          newRules = await outerRules.eval(thisContext);
        }
        candidate.parent!.adopt(newRules);
        // Rules should have index from eval, but ensure it matches candidate for sorting
        newRules.index = candidate.index;

        // Visibility should be preserved by Rules.eval - no need to set it explicitly here
        // The eval'd rules should already have their nodes registered
        // Ensure the registry is indexed before checking
        const declRegistry = newRules.getRegistry('declaration');
        declRegistry.indexPendingItems();
        // Mark output Rules as mixin output - accessible only when lookup has a target
        newRules.options.isMixinOutput = true;
        outputRules.push(newRules);
      } catch (error) {
        // If recursion was detected (ReferenceError), skip this candidate
        // This allows other candidates to still match
        if (error instanceof ReferenceError && (error as any).message?.includes('Recursive mixin call')) {
          // Skip this candidate - recursion detected
          continue;
        }
        // Re-throw other errors
        throw error;
      } finally {
        if (currentCall) {
          thisContext.callMap.delete(currentCall);
        }
      }

      /** Restore incoming rules context */
      thisContext.rulesContext = rulesContext;
    }

    /**
     * Now that we have output rules, sort them by
     * their original order
     */
    outputRules.sort(comparePosition);
    /** Create a rules wrapper - but optimize to avoid unnecessary nesting */
    let output: Rules;
    if (outputRules.length === 1) {
      output = outputRules[0]!;
      // Ensure single output rule is marked as mixin output
      output.options.isMixinOutput = true;
    } else {
      /**
       * Wrap these in rules marked as mixin output - accessible only when lookup has a target.
       * This prevents mixin output from being searched by untargeted lookups.
       */
      output = Rules.create([], {
        rulesVisibility: {
          Ruleset: 'public',
          Declaration: 'public',
          VarDeclaration: 'public',
          Mixin: 'public'
        },
        isMixinOutput: true
      });
      /**
       * Add rules but keep their original parents for further lazy lookups.
       * Ensure each rule has VarDeclaration: 'optional' before pushing (registerNode uses node's own rulesVisibility)
       */
      for (let i = 0; i < outputRules.length; i++) {
        let rule = outputRules[i]!;
        rule.frozen = true;
        /** Set a sequential index for lookup sorting */
        rule.index = i;
        output.push(rule);
      }
    }

    /** Since this is a wrapper, and rules are all evaluated, consider it evaluated */
    output.preEvaluated = true;
    output.evaluated = true;
    /** Now push all rules into the rules value */
    if (this instanceof Context) {
      output.index ??= this.ruleCounter++;
      // If the output Rules is empty, return Nil instead
      if (output.value.length === 0) {
        return new Nil();
      }
      return output;
    } else {
      const obj = output.toObject();
      return obj;
    }
  }

  return returnFunc;
}