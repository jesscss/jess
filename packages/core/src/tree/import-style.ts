import { Node, F_MAY_ASYNC, F_NON_STATIC, F_VISIBLE, defineType } from './node.js';
import { type PrintOptions, getPrintOptions } from './util/print.js';
import { type Reference } from './reference.js';
import { Rules, type RulesOptions, type RulesVisibility } from './rules.js';
import { type Quoted } from './quoted.js';
import { Url } from './url.js';
import { type Context } from '../context.js';
import { EvalState } from '../eval-state.js';
import { type MaybePromise, isThenable } from '@jesscss/awaitable-pipe';
import { isNode } from './util/is-node.js';
import { N } from './node-type.js';
import { getField, getParent, getChildren, markChangedVar, setIndex } from './util/field-helpers.js';
import type { Ruleset } from './ruleset.js';
import type { Collection } from './collection.js';
import { AtRule } from './at-rule.js';
import { Any } from './any.js';
import type { Sequence } from './sequence.js';
import type { VarDeclaration } from './declaration-var.js';

/**
 * This class is for Jess / Sass+ / Less-style imports,
 * not the CSS `@import` rule. The two will be distinguished
 * during parsing.
 *
 * @see https://sass-lang.com/documentation/at-rules/import/#plain-css-imports
 */

export type ImportOptions = {
  /**
   * Affects evaluation - will be passed to registered import handlers when parsing.
   * Normally this is done by file extension, but can be overridden to select a
   * particular plugin handler.
   *
   * e.g. `@-import (type: less) 'foo.css';`
   */
  type?: string;
  /** Rules are not rendered in output. */
  reference?: boolean;
  optional?: boolean;
  inline?: boolean;
  /**
   * Optional import postlude captured by parsers for forms like:
   * `@import (inline) "x.css" layer(foo) supports(display: grid) screen;`
   *
   * For inline imports, this is applied as serializer wrappers around the inlined source.
   */
  postlude?: Node;
  /**
   * Less's default behavior for `@import` is to only output any resolved resource once.
   * In Jess, subsequent imports should output as reference unless the `multiple` option
   * is set to true.
   *
   * @todo - Investigate what Sass does.
   */
  multiple?: boolean;
  /**
   * Allow extends to reach into this import.
   * Default is false for @-compose (protected by default), true for @-import.
   */
  mutable?: boolean;
  /**
   * Sass `@forward` semantics:
   * - members are NOT visible to the current stylesheet scope
   * - members ARE made available downstream when this stylesheet is imported
   */
  forward?: boolean;
  /**
   * Sass `@forward ... as <prefix>-*;` prefixing.
   * Stores the prefix portion (e.g. `bar-` from `bar-*`).
   */
  forwardAsPrefix?: string;
  /**
   * Sass `@forward ... show ...;` list.
   * We capture raw member names (e.g. `$a`, `mixin-b`, `fn-c`) without semantics yet.
   */
  forwardShow?: string[];
  /**
   * Sass `@forward ... hide ...;` list.
   * We capture raw member names (e.g. `$a`, `mixin-b`, `fn-c`) without semantics yet.
   */
  forwardHide?: string[];
  /** Variables can't be reassigned (default is true for `@-compose` and false for `@-import`). */
  readonly?: boolean;
  /** Internal marker for "once" de-duplication rendering semantics. */
  _dedupe?: boolean;
  [key: string]: unknown;
};

export type StyleImportOptions = {
  /**
   * Old-style `@import` type or new `@-compose` type.
   */
  type: 'import' | 'compose';

  /**
   * Options passed to the Jess import plugin. Options are interpreted like
   * querystring parameters i.e.
   *   e.g. `@-import (foo, bar, baz: 1) 'foo.css';`
   *     - foo: true
   *     - bar: true
   *     - baz: '1'
   */
  importOptions?: ImportOptions;

  /** e.g. `import * as foo` sets namespace to `foo` */
  namespace?: string;

  /** Set on the import node instead of on rules */
  local?: boolean;
  rulesVisibility?: RulesOptions['rulesVisibility'];
};

export type StyleImportValue = {
  path: Quoted | Url;

  /** The node to inject values from (Reference or Collection). */
  withNode?: Reference | Collection;

  /**
   * How the injected values are applied.
   * 'set' can be used once per module, 'with' can be used multiple.
   * In Sass, 'set' is called 'with' and 'with' will be parsed as 'set'.
   *   e.g.
   *     `@-use 'library' set { $foo: 1 };` -- $foo will be set to 1 every time
   *     `@-use 'library' with { $foo: 1 };` -- $foo will be set to 1 just for this scope.
   */
  withType?: 'with' | 'set';
};

export type StyleImportChildData = {
  path: Quoted | Url;
  withNode: Reference | Collection | undefined;
  withType: 'with' | 'set' | undefined;
};

export interface StyleImport extends Node<StyleImportValue, StyleImportOptions, StyleImportChildData> {
  type: 'StyleImport';
  shortType: 'style';
  eval(context: Context): MaybePromise<Rules>;
}
/**
 * This is a generic class for:
 *   - Sass+ `@use` (for stylesheets)
 *   - Jess `@-compose` and Less `@compose`
 *   - Less, Sass+, and Jess `@import` / `@-import` that are indicated
 *     to be processed by the engine
 *
 * @see https://sass-lang.com/documentation/at-rules/import/
 */
export class StyleImport extends Node<StyleImportValue, StyleImportOptions, StyleImportChildData> {
  static override childKeys = ['path', 'withNode'] as const;

  readonly path!: Quoted | Url;
  readonly withNode: Reference | Collection | undefined;
  private withType: 'with' | 'set' | undefined;

  override clone(deep?: boolean): this {
    const options = (this as any)._meta?.options;
    const newNode = new (this.constructor as any)(
      {
        path: deep ? this.path.clone(deep) : this.path,
        withNode: deep && this.withNode instanceof Node ? this.withNode.clone(deep) : this.withNode,
        withType: this.withType
      },
      options ? { ...options } : undefined,
      this.location,
      this.treeContext
    );
    newNode.inherit(this);
    return newNode;
  }

  constructor(value: StyleImportValue, options?: StyleImportOptions, location?: any, treeContext?: any) {
    super(value, options, location, treeContext);
    this.path = value.path;
    this.withNode = value.withNode;
    this.withType = value.withType;
    if (this.path instanceof Node) {
      this.adopt(this.path);
    }
    if (this.withNode instanceof Node) {
      this.adopt(this.withNode);
    }
    this.addFlags(F_MAY_ASYNC, F_NON_STATIC);
  }

  override toTrimmedString(options?: PrintOptions): string {
    options = getPrintOptions(options);
    const w = options.writer!;
    const mark = w.mark();
    const path = this.get('path', options.context);
    const { type, namespace, importOptions } = this.options;

    if (type === 'compose') {
      const keyword = importOptions?.forward ? '@-export' : '@-compose';
      w.add(`${keyword} `);
    } else {
      w.add('@-import ');
    }
    path.toString(options);
    if (namespace) {
      w.add(` as ${namespace}`);
    }
    w.add(';');
    return w.getSince(mark);
  }

  /** @removal-target — node-copy-reduction: clone(true) on prelude nodes.
   * Prelude should be read from canonical + position patches. */
  private materializePostludePrelude(current: Node): {
    atRuleName: '@media' | '@supports' | '@layer';
    prelude: Node;
  } {
    if (isNode(current, N.Call)) {
      const callName = String(current.get('name')).toLowerCase();
      if (callName === 'media' || callName === 'supports' || callName === 'layer') {
        const args = current.get('args')?.get('value') ?? [];
        const prelude = args.length <= 1 ? args[0] : current.get('args');
        if (prelude) {
          return {
            atRuleName: `@${callName}` as '@media' | '@supports' | '@layer',
            prelude: prelude.clone(true)
          };
        }
      }
    }

    return {
      atRuleName: '@media',
      prelude: current.clone(true)
    };
  }

  getFinalRules(evaluatedRules: Rules, context: Context) {
    let { importOptions, type } = this.options;
    const reference = importOptions!.reference;
    const isForward = importOptions!.forward === true;
    // For compose type, default is protected (not mutable). For import type, default is mutable.
    // mutable: false on @import explicitly makes it protected.
    const isProtected = type === 'compose'
      ? !importOptions!.mutable // compose: protected unless mutable: true
      : importOptions!.mutable === false; // import: mutable unless explicitly mutable: false

    let Ruleset: RulesVisibility = 'public';
    let Declaration: RulesVisibility = 'public';
    let Mixin: RulesVisibility = 'public';
    let VarDeclaration: RulesVisibility = 'public';

    if (isProtected) {
      Ruleset = 'private';
    } else if (reference) {
      /**
       * Not sure if this is true.
       * They won't be output, but that's not the same as being optional,
       * UNLESS we're extending the word 'optional' to mean "not output".
       *
       * I think what we mean here by "optional" it "not ouptut unless extended".
       * Our test for reference therefore should mimic Less behavior.
       */
      Ruleset = 'optional';
    }

    /**
     * Create a rules wrapper so we can set visibility.
     * The inner rules may be static, but the import may
     * have different import settings.
     *
     * For compose type:
     * - Variables and mixins are visible to the direct parent (the file that imports them)
     * - If 'export' flag is set, variables and mixins are also forwarded to downstream stylesheets
     * - The 'local' flag means: visible to direct parent, but not re-exported to parent's parent
     */
    const isReferenceMode = (
      (type === 'import' && (importOptions?._dedupe === true || reference))
      || (type === 'compose' && reference)
    );
    const shouldCloneImportWrapper = type === 'import' && importOptions!._dedupe === true;
    // `@import` always evaluates through a fresh shallow root clone already, so
    // finalization can mutate that per-import Rules in place. Plain `@-compose`
    // reuses cached evaluated Rules across imports, so it still needs a shallow
    // wrapper for per-import visibility/source metadata. Repeated `_dedupe`
    // imports also need an isolated shallow wrapper so the cached import root
    // keeps its canonical child array / registry slot. `_dedupe` still needs
    // child Ruleset isolation so implicit-reference extends don't contaminate
    // shared selector state.
    /** @removal-target — node-copy-reduction: materialize/clone wrappers.
     * Import/compose results should carry their EvalState. No wrapper
     * cloning needed — position patches provide isolation per import. */
    const materializeConfiguredComposeChildren = type === 'compose' && this.get('withNode', context) != null;
    // Create a lightweight output per import — canonical children, no materialization.
    // Same pattern as mixin output (finalizeMixinInvocationOutput).
    let out: Rules;
    if (type === 'import' && !shouldCloneImportWrapper) {
      out = evaluatedRules;
    } else {
      const children = [...getChildren(evaluatedRules, context)];
      out = Rules.create(children, { ...evaluatedRules.options });
      out.inherit(evaluatedRules);
    }
    if (materializeConfiguredComposeChildren) {
      const children = getChildren(out, context);
      for (let i = 0; i < children.length; i++) {
        setIndex(children[i]!, i, context);
      }
    }
    // Import type: variables are visible and re-exported (not local)
    // Compose type: variables are visible to parent but not transitive by default (`local: true`)
    // Forward: not visible locally but *is* transitive (`local: false`)
    const isLocal = type === 'compose' && !isForward;

    out.options = {
      rulesVisibility: { Ruleset, Declaration, Mixin, VarDeclaration },
      local: isLocal,
      forward: isForward,
      referenceMode: isReferenceMode,
      readonly: importOptions!.readonly ?? (type === 'compose' ? true : false)
    };
    // Forwarded modules should never render output at this scope.
    if (isForward) {
      out.removeFlag(F_VISIBLE);
    }
    // Set sourceNode so variable lookups know they can cross import boundaries
    out.sourceNode = this;
    this.adopt(out, context);
    return out;
  }

  /**
   * Defer import-path interpolation to evalNode so unresolved vars can be retried
   * after later imports/assignments in the same Rules scope have evaluated.
   */
  override preEval(_context: Context): MaybePromise<this> {
    return this;
  }

  /**
   * @note
   * When imports are evaluated, they should be deeply cloned. The reason is that
   * they can be used in multiple places, and can be evaluated differently
   * each time, so they are more like a function call.
   *
   * @todo
   * How do extends work then?
   */
  override evalNode(context: Context): MaybePromise<Rules> {
    let node = this;
    const path = node.get('path', context);
    const withNode = node.get('withNode', context);
    const withType = node.get('withType', context);
    const withValues = withNode != null ? { node: withNode, type: withType! } : undefined;
    const { options } = node;
    options.importOptions ??= {};
    const { type, importOptions } = options;
    let maybePath;
    try {
      maybePath = path.eval(context);
    } catch (e: any) {
      // Tag path-resolution errors so the eval-queue retry policy can
      // distinguish "path interpolation not ready" (cheap, worth retrying)
      // from "content evaluation failed" (expensive clone, not worth retrying).
      e._isPathResolutionError = true;
      throw e;
    }
    let originalDepth = context.depth;
    context.depth = this.depth;

    /**
     * @todo - Add options
     *
     * Note that the Less plugin should trigger a unique default behavior
     * for `@import` which is that it is de-duplicated by default. Meaning
     * that it won't render rulesets twice per compilation. I think that
     * means that it's just kind of ignored without an explicit `multiple`
     * option. Since all vars are global per compilation, it should just
     * work.
     */

    const finalize = async (finalPath: string) => {
      const previousTreeContext = context.treeContext;
      let configuredWithCanonicalParents: Map<Node, Node | undefined> | undefined;
      let dedupedCanonicalParents: Map<Node, Node | undefined> | undefined;
      let dedupedCanonicalChildren: Node[] | undefined;
      let dedupedCachedRules: Rules | undefined;
      // Inherit "reference branch" semantics lexically for nested imports unless
      // `multiple` explicitly opts into fresh output.
      const inheritedReferenceMode = context.inReferenceImportScope;
      const previousExplicitReference = importOptions!.reference;
      let pushedImportScope = false;
      if (inheritedReferenceMode && !importOptions!.multiple) {
        importOptions!.reference = true;
      }
      if (node.treeContext?.file) {
        context.treeContext = node.treeContext;
      }
      if (importOptions!.multiple || importOptions!.reference) {
        // Scope push/pop is intentionally paired in this method's try/finally.
        // This keeps branch semantics local to this import evaluation path.
        context.pushImportScope({
          multiple: importOptions!.multiple === true,
          reference: importOptions!.reference === true
        });
        pushedImportScope = true;
      }
      try {
        const isInlineImport = importOptions!.inline === true;
        let rules: Rules;
        let resolvedPath: string;
        if (isInlineImport) {
          const resolved = await context.resolveImportPath(finalPath);
          resolvedPath = resolved.resolvedPath;
          const sourceGetter = context.plugins.find(plugin => plugin.getSource);
          if (!sourceGetter) {
            throw new Error('No source getter found');
          }
          const source = await sourceGetter.getSource!(resolvedPath);
          const sourceNode = new Any(source, { role: 'any' });
          rules = this.wrapInlineSourceWithPostlude(sourceNode, importOptions!.postlude);
        } else {
          try {
            ({ node: rules, resolvedPath } = await context.getTree(finalPath, importOptions));
          } catch (error: any) {
            if (importOptions!.optional) {
              return Rules.create([]);
            }
            if (importOptions!.reference && (error?.phase === 'parse' || String(error?.code ?? '').startsWith('parse/'))) {
              return Rules.create([]);
            }
            throw error;
          }
        }
        // Set sourceNode immediately after getting the Rules, before any evaluation
        // This ensures that when preEval clones the Rules, the cloned Rules will have sourceNode set
        // and registerNode can detect this is an imported Rules
        rules.sourceNode = node;
        let evaldRules = context.evaldTrees.get(resolvedPath);

        // Compose caching semantics:
        // - The first time a module is composed, we evaluate and cache the evaluated Rules.
        // - Subsequent compose imports reuse the cached evaluated Rules (so re-imports don't re-run evaluation).
        // - Subsequent compose imports default to "reference" mode unless `multiple: true` is set,
        //   so rulesets / at-rules are not output again.
        if (type === 'compose' && evaldRules) {
          if (withValues) {
          // Sass-style: once configured, cannot be configured again.
          // (We keep parsing show/hide/prefix metadata elsewhere; this is for with/set configs.)
            throw new Error('Cannot configure a stylesheet more than once.');
          }
          // Reuse cached evaluated rules tree.
          rules = evaldRules;
          // Default: de-dupe output for compose re-imports unless explicitly multiple.
          if (!importOptions!.multiple) {
            importOptions!.reference = true;
          }
        }
        const inMultipleImportBranch = context.inMultipleImportScope;
        if (type === 'import' && importOptions!.once !== false && !importOptions!.multiple && !inMultipleImportBranch && evaldRules) {
          rules = evaldRules;
          importOptions!._dedupe = true;
          dedupedCachedRules = rules;
          dedupedCanonicalChildren = [...rules.value];
          dedupedCanonicalParents = new Map(
            rules.value.map(child => [child, child.parent] as const)
          );
        }

        // Track whether we pushed an isolated EvalState so the finally block can pop it.
        let pushedIsolatedState = false;
        if (withValues) {
          // Once configured, cannot be configured again (handled above for compose+cache).
          if (withValues.type === 'set' && evaldRules) {
            throw new Error('Cannot configure a stylesheet more than once.');
          }
          // Evaluate withValues.node if it's a Reference to get the actual Rules
          let withRulesNode = withValues.node;
          if (isNode(withRulesNode, N.Reference)) {
            const evaluated = await withRulesNode.eval(context);
            if (!isNode(evaluated, N.Collection)) {
              throw new Error('with/set node must evaluate to a Collection');
            }
            withRulesNode = evaluated;
          }
          const withRules = withRulesNode as Rules;
          if (withValues.type === 'with') {
            configuredWithCanonicalParents = new Map(
              rules.value.map(child => [child, child.parent] as const)
            );
          }

          // Build a name→index map over canonical top-level VarDeclarations for O(1) lookup.
          // This replaces the previous rules.clone(true) + registry approach — we no longer
          // deep-clone the entire imported tree just to find which declarations to override.
          // A session created in the evaluation block below ensures that evaluated/preEvaluated
          // tracking does not permanently mark canonical nodes as evaluated.
          const topLevelVarIndex = new Map<string, number>();
          for (let i = 0; i < rules.value.length; i++) {
            const n = rules.value[i]!;
            if (isNode(n, N.VarDeclaration)) {
              const varName = String((n as VarDeclaration).get('name')?.valueOf() ?? '');
              if (varName && !topLevelVarIndex.has(varName)) {
                topLevelVarIndex.set(varName, i);
              }
            }
          }

          // Separate injected variables into replacements (matched in canonical) and new variables.
          const replacementAt = new Map<number, Node>();
          const newVariables: Node[] = [];

          for (const injectedNode of withRules.value) {
            if (isNode(injectedNode, N.VarDeclaration)) {
              const varName = String((injectedNode as VarDeclaration).get('name')?.valueOf() ?? '');
              if (varName) {
                const existingIdx = topLevelVarIndex.get(varName);
                if (existingIdx !== undefined) {
                  replacementAt.set(existingIdx, injectedNode);
                } else {
                  newVariables.push(injectedNode);
                }
              } else {
                newVariables.push(injectedNode);
              }
            } else {
              newVariables.push(injectedNode);
            }
          }

          // Push an isolated EvalState so that adopt() calls inside Rules.push()
          // route parent writes into the overlay instead of permanently mutating
          // canonical library nodes.
          context.pushState(new EvalState());
          pushedIsolatedState = true;
          for (const index of replacementAt.keys()) {
            const candidate = rules.value[index];
            if (isNode(candidate, N.VarDeclaration)) {
              markChangedVar(context, candidate as VarDeclaration);
            }
          }

          // Build finalRules like mixin params: injected variables are pushed
          // canonically (they're new nodes), library children keep their canonical
          // parents untouched. We directly set the value array to avoid adopt()
          // mutating canonical library node parents.
          const finalChildren: Node[] = [];
          for (const newNode of newVariables) {
            finalChildren.push(newNode);
          }
          for (let i = 0; i < rules.value.length; i++) {
            finalChildren.push(replacementAt.get(i) ?? rules.value[i]!);
          }
          rules = Rules.create(finalChildren);
        }
        // For compose type, register and push extend root BEFORE evaluation
        // so extends inside the import use the correct root
        const parentExtendRoot = context.extendRoots.getCurrentExtendRoot();
        let pushedExtendRoot = false;
        if (type === 'compose') {
        // Register the Rules as an extend root (use rules before cloning/evaluation)
        // We'll update the registration after evaluation if the Rules changes
        // For compose type, default is protected (not mutable)
          const isComposeProtected = !importOptions!.mutable;
          context.extendRoots.registerRoot(rules, parentExtendRoot, {
            isProtected: isComposeProtected,
            isCompose: true,
            namespace: node.options.namespace
          });
          context.extendRoots.pushExtendRoot(rules);
          pushedExtendRoot = true;
        }

        /** Freshly evaluate the rules in these circumstances
       * - `with` (or `set`) values are present
       * - the rules have not been evaluated yet
       * - the import type is `import`
      */
        const activeParent = getParent(this, context);
        const shouldIsolateSelectorFrames = !isNode(activeParent ? getParent(activeParent, context) : undefined, N.Ruleset | N.AtRule);
        const prevRulesetFrames = shouldIsolateSelectorFrames ? context.rulesetFrames : undefined;
        const prevFrames = shouldIsolateSelectorFrames ? context.frames : undefined;
        if (withValues || !evaldRules || type === 'import') {
          if (!withValues && type !== 'import') {
            context.pushState(new EvalState());
            pushedIsolatedState = true;
          }
          let pushedImplicitReferenceEvalScope = false;
          const isImplicitReferenceModeForEval = (
            type === 'import'
            && importOptions!.reference !== true
            && importOptions!._dedupe === true
            && !importOptions!.multiple
          );
          if (isImplicitReferenceModeForEval) {
            // Dedupe re-imports behave like an implicit reference traversal:
            // evaluate for symbol availability, but avoid outward extend side effects.
            context.pushImportScope({ reference: true });
            pushedImplicitReferenceEvalScope = true;
          }

          // For protected imports (mutable: false), push the rules to extend root stack
          // so rulesets register in the import's registry, not the parent's
          const isImportProtected = type === 'import' && importOptions!.mutable === false;
          const shouldUseLocalExtendRoot = isImportProtected || isImplicitReferenceModeForEval;
          if (isImplicitReferenceModeForEval) {
            // Link local in-eval root so external extends can still target deduped imports.
            context.extendRoots.registerRoot(rules, parentExtendRoot, {
              isProtected: isImportProtected,
              namespace: node.options.namespace
            });
          }
          if (shouldUseLocalExtendRoot) {
            context.extendRoots.pushExtendRoot(rules);
          }

          try {
            if (shouldIsolateSelectorFrames) {
              context.rulesetFrames = [];
              context.frames = [];
            }
            // Call preEval first to get the cloned Rules (if cloning occurs)
            // sourceNode is already set above, so the cloned Rules will have it
            rules = await rules.preEval(context);
            if (type === 'import') {
            /** Needed at evaluation time for older import type */
              node.adopt(rules);
            }
            rules = await rules.eval(context);
          } finally {
            if (pushedIsolatedState) {
              const poppedState = context.popState();
              // Carry the eval state on the output so serialization can push it
              if (poppedState && poppedState.size > 0) {
                rules._carriedState = poppedState;
                context.subtreeMap.set(rules, poppedState);
              }
              pushedIsolatedState = false;
            }
            if (pushedImplicitReferenceEvalScope) {
              context.popImportScope();
            }
            if (shouldUseLocalExtendRoot) {
              context.extendRoots.popExtendRoot();
            }
            if (shouldIsolateSelectorFrames) {
              context.rulesetFrames = prevRulesetFrames!;
              context.frames = prevFrames!;
            }
          }

          // Cache compose modules (and configured modules) after first evaluation.
          if (
            type === 'compose'
            || withValues?.type === 'set'
            || (type === 'import' && importOptions!.once !== false)
          ) {
            context.evaldTrees.set(resolvedPath, rules);
          }
        } else {
        // Shallow-clone the cached rules BEFORE evaluation so registries are populated
        // on the clone, not on the cached evaldRules. EvalState isolation ensures canonical
        // children's parent pointers are protected; preEval creates fresh clones via maybeClone.
          context.pushState(new EvalState());
          rules = rules.cloneLookupSafeShallowWrapper(context) as Rules;
          // Note: For compose type, we don't set rules.parent = node
          // (only import type needs this for older import behavior)
          try {
            if (shouldIsolateSelectorFrames) {
              context.rulesetFrames = [];
              context.frames = [];
            }
            rules = await rules.eval(context);
          } finally {
            const poppedState = context.popState();
            if (poppedState && poppedState.size > 0) {
              rules._carriedState = poppedState;
              context.subtreeMap.set(rules, poppedState);
            }
            if (shouldIsolateSelectorFrames) {
              context.rulesetFrames = prevRulesetFrames!;
              context.frames = prevFrames!;
            }
          }
        }

        // Pop extend root if we pushed one
        if (pushedExtendRoot) {
          context.extendRoots.popExtendRoot();
        }

        let finalRules = node.getFinalRules(rules, context);
        if (importOptions!.postlude && !isInlineImport) {
          finalRules = this.wrapEvaluatedRulesWithPostlude(finalRules, importOptions!.postlude);
        }
        // configuredWithCanonicalParents restore removed — adopt() routes through
        // EvalState, canonical parents are not mutated.

        // For import type, register the final Rules as a child root of the parent
        // so extends from the parent can find rulesets in the imported Rules
        // Do this AFTER getFinalRules because it returns a cloned Rules
        if (type === 'import') {
          const currentParentExtendRoot = context.extendRoots.getCurrentExtendRoot();
          // Import type is mutable by default (unless explicitly mutable: false)
          const isImportProtected = importOptions!.mutable === false;
          const isImplicitReferenceModeForRegistration = (
            importOptions!._dedupe === true
            && importOptions!.reference !== true
            && !importOptions!.multiple
          );
          const shouldReRegisterLocalRootRulesets = isImportProtected || isImplicitReferenceModeForRegistration;
          context.extendRoots.registerRoot(finalRules, currentParentExtendRoot, {
            isProtected: isImportProtected,
            namespace: node.options.namespace
          });

          // For imports that evaluated under a local extend root (protected import or implicit _dedupe
          // reference traversal), rulesets were registered in the pre-finalized Rules root. Since
          // getFinalRules can clone, re-register all descendant rulesets under finalRules.
          // during preEval (when we pushed rules to the stack). Since getFinalRules clones,
          // we need to re-register rulesets in finalRules' registry.
          if (shouldReRegisterLocalRootRulesets) {
            for (const maybeRuleset of finalRules.nodes()) {
              if (isNode(maybeRuleset, N.Ruleset)) {
                finalRules.register('ruleset', maybeRuleset as Ruleset);
              }
            }
          }
        // Don't push to stack - import type uses parent's root for extends inside the import
        // But we register it so extends from parent can find rulesets in the imported Rules
        }

        return finalRules;
      } finally {
        // dedupedCachedRules/dedupedCanonicalParents restore removed —
        // eval writes go through EvalState, canonical tree is not mutated.
        context.treeContext = previousTreeContext;
        if (pushedImportScope) {
          context.popImportScope();
        }
        importOptions!.reference = previousExplicitReference;
      }
    };
    const getFinalPath = (resolvedPath: Quoted | Url): string => {
      if (resolvedPath instanceof Url) {
        return resolvedPath.pathValue(context);
      }
      const quotedValue = resolvedPath.get('value', context) as string | Node;
      if (isNode(quotedValue)) {
        return String((quotedValue as Node).valueOf());
      }
      return quotedValue as string;
    };

    if (isThenable(maybePath)) {
      return (maybePath as Promise<Quoted | Url>).then(async (p) => {
        const finalPath = getFinalPath(p);
        context.depth = originalDepth;
        return finalize(finalPath);
      });
    }
    const finalPath = getFinalPath(maybePath as Quoted | Url);
    context.depth = originalDepth;
    return finalize(finalPath as string);
  }

  /**
   * Applies CSS import postlude wrappers around inline source content.
   * Falls back to `@media <postlude>` for plain query nodes.
   */
  private wrapInlineSourceWithPostlude(sourceNode: Node, postlude?: Node): Rules {
    if (!postlude) {
      return Rules.create([sourceNode]);
    }

    let wrapped: Node = sourceNode;
    const postludeNodes: Node[] = isNode(postlude, N.Sequence | N.List) ? [...(postlude as Sequence).get('value')] : [postlude];

    for (let i = postludeNodes.length - 1; i >= 0; i--) {
      const current = postludeNodes[i]!;
      const body = Rules.create([wrapped]);
      const { atRuleName, prelude } = this.materializePostludePrelude(current);
      wrapped = new AtRule({
        name: new Any(atRuleName, { role: 'atkeyword' }),
        prelude,
        rules: body
      });
    }

    return Rules.create([wrapped]);
  }

  /**
   * Applies CSS import postlude wrappers around evaluated stylesheet rules.
   * Used for Less-style imports with media/layer/supports postludes.
   */
  private wrapEvaluatedRulesWithPostlude(rules: Rules, postlude?: Node): Rules {
    if (!postlude) {
      return rules;
    }
    const postludeNodes: Node[] = isNode(postlude, N.Sequence | N.List) ? [...(postlude as Sequence).get('value')] : [postlude];
    let wrappedRules: Rules = rules;
    for (let i = postludeNodes.length - 1; i >= 0; i--) {
      const current = postludeNodes[i]!;
      const { atRuleName, prelude } = this.materializePostludePrelude(current);
      const wrappedAtRule = new AtRule({
        name: new Any(atRuleName, { role: 'atkeyword' }),
        prelude,
        rules: wrappedRules
      });
      wrappedRules = Rules.create([wrappedAtRule]);
    }

    return wrappedRules;
  }
}

defineType<StyleImportValue>(StyleImport, 'StyleImport', 'style');

export const style = (...args: ConstructorParameters<typeof StyleImport>) => {
  return new StyleImport(...args);
};
