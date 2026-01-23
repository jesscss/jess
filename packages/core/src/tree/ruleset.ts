import { Node, F_VISIBLE, F_AMPERSAND, F_IMPLICIT_AMPERSAND, defineType, type NodeOptions } from './node.js';
import { Rules } from './rules.js';
import type { Context } from '../context.js';
import { Nil } from './nil.js';
import type { Condition } from './condition.js';
import type { Selector } from './selector.js';
import { atIndex } from './util/collections.js';
import { isNode } from './util/is-node.js';
import { Ampersand } from './ampersand.js';
import { Combinator } from './combinator.js';
import { ComplexSelector, type ComplexSelectorComponent } from './selector-complex.js';
import type { CompoundSelector } from './selector-compound.js';
import { SelectorList } from './selector-list.js';
import { PseudoSelector } from './selector-pseudo.js';
import { type PrintOptions, type FinalPrintOptions, getPrintOptions } from './util/print.js';
import { type MaybePromise, pipe, isThenable } from '@jesscss/awaitable-pipe';
import type { AtRule } from './at-rule.js';
import { serializeRulesContainer, normalizeIndent, indent } from './util/serialize-helper.js';
import { getImplicitSelector as getImplicitSelectorUtil } from './util/selector-utils.js';
import { syncLog } from './util/__tests__/debug-log.js';

export type RulesetValue = {
  selector: Selector | Nil;
  /**
   * It's important that any Node that defines a Rules
   * sets it to the `rules` property. This allows us to
   * generalize nodes for the `frames` property in Context
   */
  rules: Rules;
  guard?: Condition | Nil;
};

type RulesetOptions = NodeOptions & {
  parentSelector?: Selector | Nil;
};

/** @todo - Fix typing */
type NarrowRulesetValue<T> = T extends RulesetValue ? T : RulesetValue;
/**
 * A qualified rule. This is historically called a "Ruleset"
 * by older CSS documentation and by Less.
 *
 * @see https://developer.mozilla.org/en-US/docs/Web/CSS/Syntax#css_rulesets
 *
 * @example
 * .box {
 *   color: black;
 * }
 */
export class Ruleset<T = RulesetValue> extends Node<NarrowRulesetValue<T>, RulesetOptions> {
  type = 'Ruleset';
  shortType = 'ruleset';
  override allowRuleRoot = true;
  override allowRoot = true;
  // Ruleset has preEval method but doesn't need to set flags - preEvaluated is tracked as boolean
  frames: (Ruleset | AtRule)[] | undefined;

  // #region agent log
  private static __agentLogCount = 0;
  private static agentLog(context: Context, location: string, message: string, data: Record<string, unknown>) {
    if (process.env.DEBUG_EXTEND_BOOT !== 'true') {
      return;
    }
    if (Ruleset.__agentLogCount++ > 200) {
      return;
    }
    const filePath = context.treeContext?.file?.fullPath
      || (context.treeContext?.file?.path && context.treeContext?.file?.name
        ? `${context.treeContext.file.path}/${context.treeContext.file.name}`
        : context.treeContext?.file?.path)
      || '';
    if (typeof filePath === 'string' && !filePath.includes('tests-unit/extend-selector')) {
      return;
    }
    syncLog({
      sessionId: 'debug-session',
      runId: process.env.DEBUG_RUN_ID || 'pre-fix',
      hypothesisId: 'H8',
      location,
      message,
      data,
      timestamp: Date.now()
    });
  }
  // #endregion

  get selector() {
    return this.value.selector;
  }

  isHoisted(options: PrintOptions) {
    return this.hoistToRoot ?? options.collapseNesting ?? false;
  }

  protected _valueOf: string | undefined;

  /** Used for equality comparison with other rulesets */
  override valueOf() {
    return (this._valueOf ??= this.selector instanceof Nil ? '' : this.selector.valueOf());
  }

  /**
   * Invalidate cached selector-based string value.
   *
   * `Ruleset.valueOf()` is used by serialization frame tracking; when an extend
   * mutates `value.selector`, we must clear this cache so frame/header caching
   * reflects the updated selector.
   */
  invalidateSelectorValueCache(): void {
    this._valueOf = undefined;
  }

  override toTrimmedString(options?: PrintOptions): string {
    options = getPrintOptions(options);
    return serializeRulesContainer(this, options as FinalPrintOptions);
  }

  /**
   * Render the opening of this ruleset (selector)
   * @todo - Efficiently serialize the selector with and without comments?
  */
  getHeaderString(options: FinalPrintOptions, withoutComments?: boolean): string {
    const w = options.writer;
    const { selector } = this.value;
    const idt = indent(options.depth);

    // Should never be called for Nil selectors (serializeRulesContainer guards this),
    // but keep it safe for TypeScript and invariants.
    if (selector instanceof Nil) {
      return '';
    }

    const renderSelector = withoutComments ? (selector.copy(true) as typeof selector) : selector;

    // #region agent log
    try {
      if (process.env.DEBUG_EXTEND_BOOT === 'true') {
          const filePath = options.context?.treeContext?.file?.fullPath ?? '';
        if (typeof filePath === 'string' && filePath.includes('tests-unit/extend-exact')) {
          const v = (renderSelector as any)?.valueOf?.() ?? '';
          if (typeof v === 'string' && v.includes('.e')) {
            const type = (renderSelector as any)?.type ?? null;
            let complex: any = null;
            let list0: any = null;
            if (type === 'ComplexSelector') {
              complex = {
                len: (renderSelector as any).value?.length ?? null,
                comps: Array.isArray((renderSelector as any).value)
                  ? (renderSelector as any).value.slice(0, 8).map((c: any) => ({
                    type: c?.type ?? null,
                    v: typeof c?.valueOf === 'function' ? c.valueOf() : null
                  }))
                  : null
              };
            }
            if (type === 'SelectorList') {
              const first = (renderSelector as any).value?.[0];
              if (first) {
                list0 = {
                  type: first?.type ?? null,
                  valueOf: typeof first?.valueOf === 'function' ? first.valueOf() : null,
                  comps: Array.isArray(first?.value)
                    ? first.value.slice(0, 6).map((c: any) => ({
                      type: c?.type ?? null,
                      v: typeof c?.valueOf === 'function' ? c.valueOf() : null,
                      pre: c?.pre ?? null,
                      post: c?.post ?? null
                    }))
                    : null
                };
              }
            }
            syncLog({
              sessionId: 'debug-session',
              runId: process.env.DEBUG_RUN_ID || 'run',
              hypothesisId: 'H40',
              location: 'ruleset.ts:getHeaderString',
              message: 'render-selector-shape',
              data: { type, valueOf: v, complex, list0 },
              timestamp: Date.now()
            });
          }
        }
      }
    } catch {}
    // #endregion

    let out = withoutComments ? '' : w.capture(() => this.processPrePost('pre', undefined, options));
    let selOut = w.capture(() => renderSelector.toString(options));
    /** Normalize single spacing */
    out += selOut.replace(/[ \t]+/g, ' ');
    return normalizeIndent(selOut.replace(/\s+$/, '') + ' {', idt) + '\n';
  }

  override preEval(context: Context): MaybePromise<this> {
    if (!this.preEvaluated) {
      const node = this.maybeClone(context);
      node.preEvaluated = true;
      // Index should already be assigned by parent Rules
      node.sourceNode ??= this;
      let { selector, rules, guard } = node.value;
      // Generated wrapper rulesets (e.g. implicit `& { ... }` created by AtRule hoisting)
      // should not force var visibility to `private`, otherwise sibling vars inside the wrapper
      // (like Less `@base`) become inaccessible.
      if (!node.options.generated) {
        if (context.leakyRules) {
          rules.options.rulesVisibility.Mixin = 'public';
          rules.options.rulesVisibility.VarDeclaration = 'optional';
        } else {
          rules.options.rulesVisibility.Mixin = 'private';
          rules.options.rulesVisibility.VarDeclaration = 'private';
        }
      }
      // Check if there's a root-only at-rule between us and the parent ruleset
      // If so, don't inherit the parent selector (root-only at-rules like @keyframes
      // don't propagate parent selectors to their children)
      let shouldInheritSelector = true;
      const parentRuleset = context.rulesetFrames.at(-1);
      const parentRulesetIndex = parentRuleset ? context.frames.lastIndexOf(parentRuleset) : -1;
      if (parentRulesetIndex >= 0) {
        // Check frames after the parent ruleset for any root-only at-rules
        for (let i = parentRulesetIndex + 1; i < context.frames.length; i++) {
          const frame = context.frames[i];
          if (isNode(frame, 'AtRule') && (frame as AtRule).isRootOnly()) {
            shouldInheritSelector = false;
            break;
          }
        }
      }

      let parentSelector = shouldInheritSelector ? context.rulesetFrames.at(-1)?.selector : undefined;
      if (parentSelector && !(parentSelector instanceof Nil) && !(selector instanceof Nil)) {
        selector = getImplicitSelectorUtil(selector, parentSelector, context.opts.collapseNesting);
        selector.sourceNode = node === this ? selector.clone(true) : selector;
      }
      // DO NOT evaluate guard here - guards are evaluated at call time in getFunctionFromMixins
      // Just evaluate the selector
      // #region agent log
      if (process.env.DEBUG_EXTEND_BOOT === 'true') {
        const filePath = context.treeContext?.file?.fullPath
          || (context.treeContext?.file?.path && context.treeContext?.file?.name
            ? `${context.treeContext.file.path}/${context.treeContext.file.name}`
            : context.treeContext?.file?.path)
          || '';
        if (typeof filePath === 'string'
          && (
            filePath.includes('tests-unit/extend-selector')
            || filePath.includes('tests-unit/extend-exact')
            || filePath.includes('tests-unit/extend-media')
            || filePath.includes('tests-unit/extend-chaining')
          )
        ) {
          // Avoid stringifying selector pre-eval; just include location/type.
          syncLog({
            sessionId: 'debug-session',
            runId: process.env.DEBUG_RUN_ID || 'pre-fix',
            hypothesisId: 'H10',
            location: 'ruleset.ts:preEval',
            message: 'selector-eval-enter',
            data: {
              selectorType: selector?.type ?? null,
              rulesetLoc: node.location ?? null
            },
            timestamp: Date.now()
          });
        }
      }
      // #endregion
      return pipe(
        () => selector.eval(context),
        (sel) => {
          // #region agent log
          if (process.env.DEBUG_EXTEND_BOOT === 'true') {
            const filePath = context.treeContext?.file?.fullPath
              || (context.treeContext?.file?.path && context.treeContext?.file?.name
                ? `${context.treeContext.file.path}/${context.treeContext.file.name}`
                : context.treeContext?.file?.path)
              || '';
            if (typeof filePath === 'string'
              && (
                filePath.includes('tests-unit/extend-selector')
                || filePath.includes('tests-unit/extend-exact')
                || filePath.includes('tests-unit/extend-media')
                || filePath.includes('tests-unit/extend-chaining')
              )
            ) {
              syncLog({
                sessionId: 'debug-session',
                runId: process.env.DEBUG_RUN_ID || 'pre-fix',
                hypothesisId: 'H10',
                location: 'ruleset.ts:preEval',
                message: 'selector-eval-exit',
                data: {
                  outType: sel?.type ?? null,
                  outValue: sel ? sel.valueOf() : null
                },
                timestamp: Date.now()
              });
            }
          }
          // #endregion
          // Store the evaluated selector - this is what will be in the frame
          node.value.selector = sel as Selector | Nil;
          if (sel.hoistToRoot) {
            node.hoistToRoot = true;
          }
          // Register to extend root's registry for extend lookups
          const extendRoot = context.extendRoots.getCurrentExtendRoot();
          if (extendRoot) {
            extendRoot.getRegistry('ruleset').add(node as Ruleset);
          }
          // Depth-first: preEval child rules immediately so all nested rulesets/extends
          // are registered in source order before we process extends.
          const childRules = node.value.rules;
          if (childRules && !childRules.preEvaluated) {
            // #region agent log
            const filePath = context.treeContext?.file?.fullPath ?? '';
            if (typeof filePath === 'string' && filePath.includes('extend-media')) {
              const selectorV = (node as Ruleset).selector?.valueOf?.() ?? '';
              syncLog({
                sessionId: 'debug-session',
                runId: process.env.DEBUG_RUN_ID || 'run',
                hypothesisId: 'H44',
                location: 'ruleset.ts:preEval',
                message: 'ruleset-preEval-calling-childRules-preEval',
                data: {
                  selector: selectorV,
                  extendsCountBefore: context.extends.length
                },
                timestamp: Date.now()
              });
            }
            // #endregion
            const preEvaldRules = childRules.preEval(context);
            if (isThenable(preEvaldRules)) {
              return (preEvaldRules as Promise<Rules>).then((rules) => {
                // #region agent log
                if (typeof filePath === 'string' && filePath.includes('extend-media')) {
                  const selectorV = (node as Ruleset).selector?.valueOf?.() ?? '';
                  syncLog({
                    sessionId: 'debug-session',
                    runId: process.env.DEBUG_RUN_ID || 'run',
                    hypothesisId: 'H44',
                    location: 'ruleset.ts:preEval',
                    message: 'ruleset-preEval-childRules-preEval-complete-async',
                    data: {
                      selector: selectorV,
                      extendsCountAfter: context.extends.length
                    },
                    timestamp: Date.now()
                  });
                }
                // #endregion
                node.value.rules = rules;
                return node;
              });
            }
            // #region agent log
            if (typeof filePath === 'string' && filePath.includes('extend-media')) {
              const selectorV = (node as Ruleset).selector?.valueOf?.() ?? '';
              syncLog({
                sessionId: 'debug-session',
                runId: process.env.DEBUG_RUN_ID || 'run',
                hypothesisId: 'H44',
                location: 'ruleset.ts:preEval',
                message: 'ruleset-preEval-childRules-preEval-complete-sync',
                data: {
                  selector: selectorV,
                  extendsCountAfter: context.extends.length
                },
                timestamp: Date.now()
              });
            }
            // #endregion
            node.value.rules = preEvaldRules as Rules;
          }
          return node;
        }
      );
    }
    return this;
  }

  /** Attach an (invisible) ampersand to the selector(s) if it's not already there */
  getImplicitSelector(parentSelector: Selector, collapseNesting = false) {
    if (this.selector instanceof Nil) {
      return this.selector;
    }
    return getImplicitSelectorUtil(this.selector, parentSelector, collapseNesting);
  }

  override copy(deep?: boolean): this {
    const node = super.copy(deep);
    const selectorSourceNode = this.value.selector.sourceNode;
    node.value.selector = selectorSourceNode.copy(true) as Selector | Nil;
    node.value.selector.sourceNode = selectorSourceNode;
    return node;
  }

  override evalNode(context: Context): MaybePromise<Ruleset | Rules | Nil> {
    if (this.evaluated) {
      return this;
    }
    let pushedFrames = false;
    /** Should have been maybe cloned in preEval */
    this.evaluated = true;
    const collapseNesting = context.opts.collapseNesting;

    // #region agent log
    const __t0 = Date.now();
    Ruleset.agentLog(context, 'ruleset.ts:evalNode', 'ruleset-eval-enter', {
      selector: this.value.selector instanceof Nil ? null : this.value.selector.valueOf(),
      hasGuard: !!this.value.guard && !(this.value.guard instanceof Nil),
      rulesLen: Array.isArray(this.value.rules?.value) ? this.value.rules.value.length : null,
      framesLen: Array.isArray(context.frames) ? context.frames.length : null
    });
    // #endregion

    // Store frames snapshot for collapseNesting serialization
    if (collapseNesting) {
      this.frames = [...context.frames];
    }

    return pipe(
      () => {
        let { selector, guard } = this.value;
        // Guard was already set to Nil (failed in a previous eval)
        if (guard instanceof Nil) {
          return guard;
        }
        // Evaluate guard at definition time (not call time like mixins)
        // This is different from mixins because rulesets can't use caller scope for guards
        if (guard) {
          return pipe(
            () => guard.eval(context),
            (guardResult) => {
              if (!guardResult.value) {
                // Guard failed - mark as Nil and return it
                this.value.guard = new Nil();
                return new Nil();
              }
              // Guard passed - clear it and continue with selector evaluation
              this.value.guard = undefined;
              return undefined;
            }
          );
        }
        return undefined;
      },
      (guardResult) => {
        // If guard failed, return Nil (ruleset produces no output)
        if (guardResult instanceof Nil) {
          return guardResult;
        }
        let { selector } = this.value;
        const frame = atIndex(context.rulesetFrames, -1);
        if (frame && (this.hoistToRoot ?? context.opts.collapseNesting)) {
          this.hoistToRoot = true;
        }
        // Unwrap generated :is() pseudo-selectors if they're the ruleset's only selector
        // or if they're the first component of a ComplexSelector in the parent
        if (
          isNode(selector, 'PseudoSelector')
          && selector.value.name === ':is'
          && selector.generated
        ) {
          selector = selector.value.arg as Selector;
        }

        // Also check if the selector is a ComplexSelector that contains a :is() as its first component
        if (isNode(selector, 'ComplexSelector')) {
          let first = selector.value[0];
          let outer: ComplexSelector | CompoundSelector = selector;
          if (isNode(first, 'CompoundSelector')) {
            outer = first;
            first = first.value[0];
          }
          if (
            isNode(first, 'PseudoSelector')
            && first.value.name === ':is'
            && first.generated
            && first.value.arg!.type !== 'SelectorList'
          ) {
            outer.value[0] = first.value.arg! as ComplexSelectorComponent;
          }
        }

        // Unwrap generated :is() if it's the first or only component of a CompoundSelector
        if (isNode(selector, 'CompoundSelector')) {
          const first = selector.value[0];
          if (
            isNode(first, 'PseudoSelector')
            && first.value.name === ':is'
            && first.generated
            && first.value.arg!.type !== 'SelectorList'
          ) {
            // Unwrap the :is() - use its argument as the selector
            if (selector.value.length === 1) {
              selector = selector.value[0]!;
            } else {
              selector.value[0] = first.value.arg! as ComplexSelectorComponent;
            }
          }
        }
        if (selector instanceof Nil) {
          // If selector evaluates to Nil, return the rules body directly instead of the ruleset
          // This allows rules to be output even when there's no selector context
          // We don't push frames because there's no selector context
          // Store Nil in selector so next step can detect this case
          this.value.selector = selector;
          const evaluatedRules = this.value.rules.eval(context);
          // Update this.value.rules to point to evaluated Rules to prevent circular reference
          // when debug code traverses the AST
          if (isThenable(evaluatedRules)) {
            return (evaluatedRules as Promise<Rules>).then((rules) => {
              this.value.rules = rules;
              return rules;
            });
          }
          this.value.rules = evaluatedRules as Rules;
          return evaluatedRules;
        }
        // Preserve the sourceNode from the current selector before replacing it
        const preservedSourceNode = this.value.selector?.sourceNode;
        this.value.selector = selector;
        // Restore the sourceNode on the new selector so it's available when copying
        if (preservedSourceNode && this.value.selector) {
          this.value.selector.sourceNode = preservedSourceNode;
        }
        if (context.opts.collapseNesting) {
          this.hoistToRoot = true;
        }
        context.rulesetFrames.push(this as Ruleset);
        context.frames.push(this);
        pushedFrames = true;
        // #region agent log
        Ruleset.agentLog(context, 'ruleset.ts:evalNode', 'ruleset-eval-rules-enter', {
          selector: this.value.selector instanceof Nil ? null : this.value.selector.valueOf()
        });
        // #endregion
        return this.value.rules.eval(context);
      },
      (evaluatedRules: Rules | Nil) => {
        if (pushedFrames) {
          context.rulesetFrames.pop();
          context.frames.pop();
        }
        // #region agent log
        Ruleset.agentLog(context, 'ruleset.ts:evalNode', 'ruleset-eval-exit', {
          selector: this.value.selector instanceof Nil ? null : this.value.selector.valueOf(),
          rulesNil: evaluatedRules instanceof Nil,
          durationMs: Date.now() - __t0
        });
        // #endregion
        if (evaluatedRules instanceof Nil) {
          return evaluatedRules;
        }

        // If selector was Nil, evaluatedRules is already Rules (not wrapped in Ruleset)
        // In that case, return it directly without wrapping back in Ruleset
        if (this.value.selector instanceof Nil) {
          // Selector was Nil, so we already returned Rules directly - just return it
          return evaluatedRules;
        }

        this.value.rules = evaluatedRules;
        const rules = this.value.rules;

        if (rules.visibleRules().length === 0) {
          this.removeFlag(F_VISIBLE);
        }
        return this;
      }
    );
  }

  /** @todo move to ToCssVisitor */
  // toCSS(context: Context, out: OutputCollector) {
  //   const { sels, value } = this
  //   context.inSelector = true
  //   sels.toCSS(context, out)
  //   context.inSelector = false
  //   out.add(' ')
  //   value.toCSS(context, out)
  // }

  /** @todo Move to ToModuleVisitor */
  // toModule(context: Context, out: OutputCollector) {
  //   out.add('$J.rule({\n', this.location)
  //   context.indent++
  //   const pre = context.pre
  //   out.add(`${pre}sels: `)
  //   this.sels.toModule(context, out)
  //   out.add(`,\n${pre}value: `)
  //   this.value.toModule(context, out)
  //   context.indent--
  //   out.add(`},${JSON.stringify(this.location)})`)
  // }
}

type RulesetParams = ConstructorParameters<typeof Ruleset>;

export const ruleset = defineType<RulesetValue>(Ruleset, 'Ruleset') as (
  value: RulesetValue | RulesetParams[0],
  options?: RulesetParams[1],
  location?: RulesetParams[2],
  treeContext?: RulesetParams[3]
) => Ruleset;