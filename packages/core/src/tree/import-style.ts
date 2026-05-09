import { Node, F_MAY_ASYNC, F_NON_STATIC, F_VISIBLE, defineType } from './node.js';
import { type Reference } from './reference.js';
import { Rules, type RulesOptions, type RulesVisibility } from './rules.js';
import { type Quoted } from './quoted.js';
import { Url } from './url.js';
import { type Context } from '../context.js';
import { type MaybePromise, isThenable } from '@jesscss/awaitable-pipe';
import { isNode } from './util/is-node.js';
import { N } from './node-type.js';
import type { Ruleset } from './ruleset.js';
import type { Collection } from './collection.js';
import { AtRule } from './at-rule.js';
import { Any } from './any.js';
import { Sequence } from './sequence.js';
import { registerRulesetWithRoot } from './util/extend-roots.js';
import { buildScopeFrame, type BindingCell } from './scope-frame.js';
import { canReuseLeaf, reuseLeaf } from './util/cloning.js';

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

  /** Values to inject */
  with?: {
    node: Reference | Collection;
    /**
     * For use / ref / include statements, will affect how this module is evaluated
     * every time. 'set' can be used once per module, 'with' can be used multiple.
     * In Sass, 'set' is called 'with' and 'with' will be parsed as 'set'.
     *   e.g.
     *     `@-use 'library' set { $foo: 1 };` -- $foo will be set to 1 every time
     *     `@-use 'library' with { $foo: 1 };` -- $foo will be set to 1 just for this scope.
     */
    type: 'with' | 'set';
  };
};

export interface StyleImport extends Node<StyleImportValue, StyleImportOptions> {
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
export class StyleImport extends Node<StyleImportValue, StyleImportOptions> {
  private getImportAnchorRules(context: Context): Rules {
    return isNode(context.rulesContext, N.Rules)
      ? context.rulesContext
      : isNode(this.parent, N.Rules)
        ? this.parent
        : context.root;
  }

  /**
   * Derive an import-owned Rules surface from the active anchor.
   *
   * This is not a clone-isolation mechanism. Imports use these surfaces to hold
   * semantic placement state: configured bindings, visibility/reference options,
   * inline source text, or real postlude containers like `@media`.
   */
  private deriveRulesSurface(
    anchorRules: Rules,
    childNodes?: Node[],
    options?: {
      preserveSourceNode?: boolean;
      resetScopeFrame?: boolean;
    }
  ): Rules {
    const sourceLocation = anchorRules.location.length === 6 ? anchorRules.location : undefined;
    const wrapped = childNodes !== undefined
      ? new Rules([], anchorRules.options ? { ...anchorRules.options } : undefined, sourceLocation, anchorRules.treeContext).inherit(anchorRules)
      : anchorRules.derive();
    if (options?.resetScopeFrame) {
      wrapped.scopeFrame = undefined;
    }
    if (options?.preserveSourceNode) {
      wrapped.sourceNode = anchorRules.sourceNode ?? anchorRules;
    }
    if (childNodes) {
      wrapped.set(null, []);
      for (const childNode of childNodes) {
        wrapped.adopt(childNode);
        wrapped.value.push(childNode);
      }
    }
    return wrapped;
  }

  private createImportAnchorSurface(context: Context, childNodes?: Node[]): Rules {
    return this.deriveRulesSurface(this.getImportAnchorRules(context), childNodes ?? [], { resetScopeFrame: true });
  }

  private getPostludeNodes(postlude?: Node): Node[] {
    if (!postlude) {
      return [];
    }
    return isNode(postlude, N.Sequence) || isNode(postlude, N.List) ? postlude.value : [postlude];
  }

  private wrapRulesInAtRuleSurface(anchorRules: Rules, rules: Rules, name: string, prelude: Node): Rules {
    const wrappedAtRule = new AtRule({
      name: new Any(name, { role: 'atkeyword' }),
      prelude,
      rules
    });
    return this.deriveRulesSurface(anchorRules, [wrappedAtRule], { resetScopeFrame: true });
  }

  private clearConfiguredImportBoundary(rules: Rules): void {
    delete rules.options.importBoundary;
  }

  private throwIfConfiguredReuseIsDisallowed(withValues: StyleImportValue['with'] | undefined, hasCachedEvaluation: boolean): void {
    if (!withValues || !hasCachedEvaluation) {
      return;
    }

    if (withValues.type === 'set' || this.options.type === 'compose') {
      throw new Error('Cannot configure a stylesheet more than once.');
    }
  }

  private async resolveConfiguredRulesInput(context: Context, withNode: Reference | Collection): Promise<Rules> {
    if (isNode(withNode, N.Reference)) {
      const evaluated = await withNode.eval(context);
      if (!isNode(evaluated, N.Collection)) {
        throw new Error('with/set node must evaluate to a Collection');
      }
      return evaluated as Rules;
    }

    return withNode as Rules;
  }

  private partitionConfiguredNodes(sourceRules: Rules, withRules: Rules): {
    newVariables: Node[];
    replacementsByIndex: Map<number, Node>;
  } {
    const firstVarIndexByName = new Map<string, number>();
    for (let index = 0; index < sourceRules.value.length; index++) {
      const existingNode = sourceRules.value[index]!;
      if (!isNode(existingNode, N.VarDeclaration)) {
        continue;
      }
      const existingName = existingNode.value.name?.toString();
      if (existingName && !firstVarIndexByName.has(existingName)) {
        firstVarIndexByName.set(existingName, index);
      }
    }

    const newVariables: Node[] = [];
    const replacementsByIndex = new Map<number, Node>();
    for (const injectedNode of withRules.value) {
      if (isNode(injectedNode, N.VarDeclaration)) {
        const varName = injectedNode.value.name?.toString();
        if (varName) {
          const existingIndex = firstVarIndexByName.get(varName);
          if (existingIndex !== undefined) {
            replacementsByIndex.set(existingIndex, injectedNode);
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

    return {
      newVariables,
      replacementsByIndex
    };
  }

  private createConfiguredImportedSurface(sourceRules: Rules, replacementsByIndex?: Map<number, Node>): Rules {
    const importedRules = this.deriveRulesSurface(sourceRules, undefined, { preserveSourceNode: true });
    if (!replacementsByIndex?.size) {
      return importedRules;
    }

    importedRules.set(null, []);
    for (let index = 0; index < sourceRules.value.length; index++) {
      const originalNode = sourceRules.value[index]!;
      const nextNode = replacementsByIndex.get(index) ?? originalNode;
      importedRules.adopt(nextNode);
      importedRules.value.push(nextNode);
    }
    return importedRules;
  }

  private createConfiguredResultSurface(
    sourceRules: Rules,
    importedRules: Rules,
    additiveNodes: Node[]
  ): Rules {
    const additiveVariableNodes = additiveNodes.filter(node => isNode(node, N.VarDeclaration));
    const additiveNonVariableNodes = additiveNodes.filter(node => !isNode(node, N.VarDeclaration));
    this.clearConfiguredImportBoundary(importedRules);
    if (additiveNonVariableNodes.length === 0) {
      this.attachConfiguredVarBindings(importedRules, additiveVariableNodes);
      return importedRules;
    }

    const finalRules = this.deriveRulesSurface(sourceRules, [], { resetScopeFrame: true });
    for (const newNode of additiveNonVariableNodes) {
      finalRules.adopt(newNode);
      finalRules.value.push(newNode);
    }
    this.attachConfiguredVarBindings(finalRules, additiveVariableNodes);
    finalRules.adopt(importedRules);
    finalRules.value.push(importedRules);
    return finalRules;
  }

  private applyConfiguredValues(sourceRules: Rules, withRules: Rules): Rules {
    const { newVariables, replacementsByIndex } = this.partitionConfiguredNodes(sourceRules, withRules);

    if (newVariables.length === 0 && replacementsByIndex.size === 0) {
      return sourceRules;
    }

    const importedRules = this.createConfiguredImportedSurface(
      sourceRules,
      replacementsByIndex.size > 0 ? replacementsByIndex : undefined
    );

    return this.createConfiguredResultSurface(sourceRules, importedRules, newVariables);
  }

  private attachConfiguredVarBindings(targetRules: Rules, variableNodes: Node[]): void {
    const liveSlots = new Map(targetRules.scopeFrame?.liveSlotsByName ?? []);
    let didAdd = false;
    for (const node of variableNodes) {
      if (!isNode(node, N.VarDeclaration)) {
        continue;
      }
      const name = node.value.name?.toString();
      if (!name) {
        continue;
      }
      liveSlots.set(name, {
        value: node.value.value,
        sourceNode: node,
        readonly: node.options?.readonly
      } satisfies BindingCell);
      didAdd = true;
    }
    if (!didAdd) {
      return;
    }
    targetRules.scopeFrame = buildScopeFrame(
      undefined,
      targetRules,
      targetRules.scopeFrame?.parent,
      liveSlots,
      targetRules.scopeFrame?.pendingDeclarationNames
    );
  }

  private toImportPathNode(node: Node): Quoted | Url {
    if (isNode(node, N.Quoted) || node instanceof Url) {
      return node;
    }
    throw new Error('Import path must evaluate to a quoted string or url() node.');
  }

  private isPlainCssImport(finalPath: string): boolean {
    const { importOptions } = this.options;
    if (
      importOptions?.inline === true
      || importOptions?.type === 'less'
      || importOptions?.reference === true
      || importOptions?.multiple === true
      || importOptions?.optional === true
    ) {
      return false;
    }
    const lower = finalPath.toLowerCase();
    if (/\.css([?#].*)?$/.test(lower)) {
      return true;
    }
    return lower.startsWith('http://') || lower.startsWith('https://') || lower.startsWith('//');
  }

  private createCssImportAtRule(pathNode: Quoted | Url): AtRule {
    const preludeNodes: Node[] = [pathNode];
    preludeNodes.push(...this.getPostludeNodes(this.options.importOptions?.postlude));
    const prelude = preludeNodes.length === 1
      ? preludeNodes[0]
      : new Sequence(preludeNodes, undefined, undefined, this.treeContext);

    const location = this.location && this.location.length === 6 ? this.location : undefined;
    return new AtRule({
      name: new Any('@import', { role: 'atkeyword' }),
      prelude
    }, undefined, location, this.treeContext);
  }

  private queueCssImport(context: Context, importRule: AtRule): void {
    if (context.inReferenceImportScope) {
      return;
    }
    const topImports = (context.topImports ??= []);
    const nodeLoc = importRule.location?.join(':') ?? '';
    const nodeSig = `${importRule.value.name.valueOf?.() ?? importRule.value.name}:${importRule.value.prelude?.valueOf?.() ?? ''}`;
    const alreadyQueued = topImports.some((queuedNode) => {
      if (!isNode(queuedNode, N.AtRule)) {
        return false;
      }
      const queued = queuedNode as AtRule;
      return (
        queued === importRule
        || queued.sourceNode === importRule.sourceNode
        || queued.sourceNode === importRule
        || (
          (queued.location?.join(':') ?? '') === nodeLoc
          && `${queued.value.name.valueOf?.() ?? queued.value.name}:${queued.value.prelude?.valueOf?.() ?? ''}` === nodeSig
        )
      );
    });
    if (!alreadyQueued) {
      topImports.push(importRule);
    }
  }

  constructor(value: StyleImportValue, options?: StyleImportOptions, location?: any, treeContext?: any) {
    super(value, options, location, treeContext);
    // Style imports are always non-static and may be async
    this.addFlags(F_MAY_ASYNC, F_NON_STATIC);
  }

  getFinalRules(evaluatedRules: Rules) {
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
    // Import type: variables are visible and re-exported (not local)
    // Compose type: variables are visible to parent but not transitive by default (`local: true`)
    // Forward: not visible locally but *is* transitive (`local: false`)
    const isLocal = type === 'compose' && !isForward;
    const readonly = importOptions!.readonly ?? (type === 'compose' ? true : false);
    const canReuseEvaluatedRules = !isProtected && !isReferenceMode && !isLocal && !isForward && !readonly;
    if (canReuseEvaluatedRules) {
      this.adopt(evaluatedRules);
      return evaluatedRules;
    }
    // Shallow clone the Rules wrapper. The children are shared with the
    // canonical tree/session result for this import placement — per-render
    // options (visibility, reference mode) are set on the wrapper below;
    // downstream serialization propagates `referenceMode` via PrintOptions,
    // so we don't need to mutate every child's `options.referenceMode`.
    let out = evaluatedRules.derive();
    const hasImportBoundary = (
      evaluatedRules.options.importBoundary === true
      || (isNode(evaluatedRules.sourceNode, N.Rules) && evaluatedRules.sourceNode.options.importBoundary === true)
    );
    out.options = {
      rulesVisibility: { Ruleset, Declaration, Mixin, VarDeclaration },
      local: isLocal,
      forward: isForward,
      importBoundary: hasImportBoundary,
      referenceMode: isReferenceMode,
      readonly
    };
    out._hasReferenceImports = isReferenceMode || evaluatedRules._hasReferenceImports;
    // Forwarded modules should never render output at this scope.
    if (isForward) {
      out.removeFlag(F_VISIBLE);
    }
    this.adopt(out);
    return out;
  }

  /**
   * Defer import-path interpolation to evalNode so unresolved vars can be retried
   * after later imports/assignments in the same Rules scope have evaluated.
   */
  override preEval(context: Context): MaybePromise<this> {
    return this.prepareRegistration(context);
  }

  override prepareRegistration(_context: Context): MaybePromise<this> {
    return this;
  }

  private _preparePathIdentity(context: Context): MaybePromise<Node> {
    try {
      return this.value.path.eval(context);
    } catch (e: any) {
      // Tag path-resolution errors so the eval-queue retry policy can
      // distinguish "path interpolation not ready" (cheap, worth retrying)
      // from "content evaluation failed" (expensive clone, not worth retrying).
      e._isPathResolutionError = true;
      throw e;
    }
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
    const { with: withValues } = node.value;
    const { options } = node;
    options.importOptions ??= {};
    const { type, importOptions } = options;
    const maybePath = this._preparePathIdentity(context);
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

    const finalize = async (finalPath: string, evaluatedPathNode: Quoted | Url) => {
      const previousTreeContext = context.treeContext;
      // Inherit "reference branch" semantics lexically for nested imports unless
      // `multiple` explicitly opts into fresh output.
      const inheritedReferenceMode = context.inReferenceImportScope;
      const previousExplicitReference = importOptions!.reference;
      let pushedImportScope = false;
      if (inheritedReferenceMode && !importOptions!.multiple) {
        importOptions!.reference = true;
      }
      if (node.treeContext) {
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
        if (this.isPlainCssImport(finalPath)) {
          const importRule = this.createCssImportAtRule(evaluatedPathNode);
          this.queueCssImport(context, importRule);
          return this.createImportAnchorSurface(context);
        }
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
          const sourceRules = this.createImportAnchorSurface(context, [sourceNode]);
          rules = this.wrapRulesWithPostlude(sourceRules, importOptions!.postlude);
        } else {
          try {
            ({ node: rules, resolvedPath } = await context.getTree(finalPath, importOptions));
          } catch (error: any) {
            if (importOptions!.optional) {
              return this.createImportAnchorSurface(context);
            }
            if (importOptions!.reference && (error?.phase === 'parse' || String(error?.code ?? '').startsWith('parse/'))) {
              return this.createImportAnchorSurface(context);
            }
            throw error;
          }
        }
        // Mark import-boundary semantics on the Rules surface directly instead
        // of depending on source-node provenance walks.
        rules.options.importBoundary ??= this.options.type !== 'import';
        let evaldRules = context.evaldTrees.get(resolvedPath);
        if (type === 'import' && !evaldRules && !withValues) {
          // Plain imports still need an import-site-local Rules surface during
          // preparation/eval. Reusing the canonical source tree here lets the first
          // import site become the parent of later `multiple` / `reference`
          // imports, which leaks the wrong selector/context into repeated uses.
          const cloneChild = (node: Node): Node => {
            if (canReuseLeaf(node)) {
              return reuseLeaf(node);
            }
            return node.clone(true, cloneChild);
          };
          rules = rules.clone(true, cloneChild) as Rules;
        }

        // Compose caching semantics:
        // - The first time a module is composed, we evaluate and cache the evaluated Rules.
        // - Subsequent compose imports reuse the cached evaluated Rules (so re-imports don't re-run evaluation).
        // - Subsequent compose imports default to "reference" mode unless `multiple: true` is set,
        //   so rulesets / at-rules are not output again.
        if (type === 'compose' && evaldRules) {
          // Sass-style: once configured, cannot be configured again.
          // (We keep parsing show/hide/prefix metadata elsewhere; this is for with/set configs.)
          this.throwIfConfiguredReuseIsDisallowed(withValues, true);
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
        }

        if (withValues) {
          this.throwIfConfiguredReuseIsDisallowed(withValues, Boolean(evaldRules));
          const withRules = await this.resolveConfiguredRulesInput(context, withValues.node);
          rules = this.applyConfiguredValues(rules, withRules);
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

        try {
          /** Freshly evaluate the rules in these circumstances
         * - `with` (or `set`) values are present
         * - the rules have not been evaluated yet
         * - the import type is `import`
        */
          if (withValues || !evaldRules || type === 'import') {
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
              // Prepare registration first to get the cloned Rules (if cloning occurs)
              // sourceNode is already set above, so the cloned Rules will have it
              const preparedRules = await rules.prepareRegistration(context);
              if (!(preparedRules instanceof Rules)) {
                throw new TypeError('Expected imported rules registration prep to return Rules');
              }
              rules = preparedRules;
              if (type === 'import') {
                /** Needed at evaluation time for older import type */
                node.adopt(rules);
              }
              rules = await rules.eval(context);
            } finally {
              if (pushedImplicitReferenceEvalScope) {
                context.popImportScope();
              }
              if (shouldUseLocalExtendRoot) {
                context.extendRoots.popExtendRoot();
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
            // Compose cache hit: `rules` is already the cached canonical/session
            // result from `context.evaldTrees` (assigned at line 353). No clone
            // and no re-eval is needed — shape differences per compose scope are
            // handled by the shallow wrapper built in `getFinalRules` below,
            // which applies per-scope visibility/reference options without
            // mutating the shared cached tree.
          }
        } finally {
          if (pushedExtendRoot) {
            context.extendRoots.popExtendRoot();
          }
        }

        // NB: previously this block cleared `referenceMode` on both `rules`
        // and the finalRules wrapper when `evaluatedInImplicitReferenceMode`
        // was true. That was a workaround for the old `markReferenceMode`
        // eval-time walk, which tagged every descendant node individually.
        // With the walk gone, the wrapper's `options.referenceMode` is the
        // only reference-mode signal downstream renders will see, so
        // clearing it here defeats dedupe suppression entirely.
        let finalRules = node.getFinalRules(rules);
        if (importOptions!.postlude && !isInlineImport) {
          finalRules = this.wrapRulesWithPostlude(finalRules, importOptions!.postlude);
        }

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
          // reference traversal), rulesets were registered against the pre-finalized Rules root. Since
          // getFinalRules can clone, re-register all descendant rulesets under finalRules' extend root set.
          if (shouldReRegisterLocalRootRulesets) {
            for (const maybeRuleset of finalRules.nodes()) {
              if (isNode(maybeRuleset, N.Ruleset)) {
                registerRulesetWithRoot(finalRules, maybeRuleset as Ruleset);
              }
            }
          }
        // Don't push to stack - import type uses parent's root for extends inside the import
        // But we register it so extends from parent can find rulesets in the imported Rules
        }

        return finalRules;
      } finally {
        context.treeContext = previousTreeContext;
        if (pushedImportScope) {
          context.popImportScope();
        }
        importOptions!.reference = previousExplicitReference;
      }
    };
    if (isThenable(maybePath)) {
      return maybePath.then(async (p) => {
        const finalPath = String(p.valueOf());
        context.depth = originalDepth;
        return finalize(finalPath, this.toImportPathNode(p));
      });
    }
    const finalPath = String(maybePath.valueOf());
    context.depth = originalDepth;
    return finalize(finalPath, this.toImportPathNode(maybePath));
  }

  override resolve(context: Context): MaybePromise<Rules> {
    return this.evalNode(context);
  }

  private wrapRulesWithPostlude(rules: Rules, postlude?: Node): Rules {
    if (!postlude) {
      return rules;
    }
    const postludeNodes = this.getPostludeNodes(postlude);
    const anchorRules = rules;
    let wrappedRules: Rules = rules;
    for (let i = postludeNodes.length - 1; i >= 0; i--) {
      const current = postludeNodes[i]!;
      if (isNode(current, N.Call)) {
        const callName = String(current.value.name).toLowerCase();
        if (callName === 'media' || callName === 'supports' || callName === 'layer') {
          const args = current.value.args?.value ?? [];
          const prelude = args.length <= 1 ? args[0] : current.value.args;
          if (prelude) {
            wrappedRules = this.wrapRulesInAtRuleSurface(anchorRules, wrappedRules, `@${callName}`, prelude);
            continue;
          }
        }
      }

      wrappedRules = this.wrapRulesInAtRuleSurface(anchorRules, wrappedRules, '@media', current);
    }

    return wrappedRules;
  }
}

defineType<StyleImportValue>(StyleImport, 'StyleImport', 'style');

export const style = (...args: ConstructorParameters<typeof StyleImport>) => {
  return new StyleImport(...args);
};
