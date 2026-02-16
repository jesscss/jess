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
import { processLeadingIs } from './util/process-leading-is.js';
import { syncLog } from './util/__tests__/debug-log.js';
import { shouldTraceExtend, getExtendTraceRunId } from './util/extend-trace-debug.js';
import { registerRulesetWithRoot } from './util/extend-roots.js';
import { ensureRulesetTraceId, getOptionalRulesetTraceId } from './util/ruleset-trace.js';

export type RulesetValue = {
  selector: Selector | Nil;
  /**
   * It's important that any Node that defines a Rules
   * sets it to the `rules` property. This allows us to
   * generalize nodes for the `frames` property in Context
   */
  rules: Rules;
  guard?: Condition | Nil;
  /**
   * When this ruleset is extended, we store its selector before the first extend.
   * Nested rulesets' implicit & (selectorContainer → parent value) use this when set, so they
   * do not "see" the extended form (EXTEND_RULES §5: do not materialize ampersands
   * that were not matched and extended).
   */
  selectorBeforeExtend?: Selector | Nil;
};

type RulesetOptions = NodeOptions & {
  parentSelector?: Selector | Nil;
  /** Own selector before parent resolution (getImplicitSelector); used by extend so nested rulesets extend .replace,.c not the resolved form. */
  ownSelector?: Selector | Nil;
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

  get selector() {
    return this.value.selector;
  }

  /**
   * If this ruleset shares its value object with a descendant ruleset, give those
   * descendants their own value so mutating this ruleset's value.selector does not
   * overwrite the descendant's selector (e.g. .rep_ace nested ruleset case).
   */
  static ensureDescendantRulesetsHaveOwnValue(
    ruleset: Ruleset,
    sharedValue: RulesetValue
  ): void {
    const rules = ruleset.value?.rules;
    if (!rules || !isNode(rules, 'Rules')) {
      return;
    }
    const children = (rules as Rules).value;
    if (!Array.isArray(children)) {
      return;
    }
    for (const child of children) {
      if (!isNode(child, 'Ruleset')) {
        continue;
      }
      const rs = child as Ruleset;
      if (rs.value === sharedValue) {
        rs.value = {
          selector: rs.value.selector,
          rules: rs.value.rules,
          ...(rs.value.guard !== undefined && { guard: rs.value.guard })
        };
      }
      Ruleset.ensureDescendantRulesetsHaveOwnValue(rs, sharedValue);
    }
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
  /** Ensure every node in the selector has F_VISIBLE so toString() does not skip them (rep_ace bug).
   * Do NOT add F_VISIBLE to implicit ampersands: they must stay invisible so nested output stays short. */
  private static ensureSelectorVisible(sel: Selector | Nil): void {
    if (!sel || sel instanceof Nil || typeof (sel as Node).addFlag !== 'function') {return;}
    const n = sel as Node;
    if (isNode(sel, 'Ampersand') && n.hasFlag(F_IMPLICIT_AMPERSAND)) {
      return;
    }
    if (!n.hasFlag(F_VISIBLE)) {n.addFlag(F_VISIBLE);}
    if (isNode(sel, 'SelectorList')) {
      const list = sel as SelectorList;
      if (Array.isArray(list.value)) {for (const item of list.value) Ruleset.ensureSelectorVisible(item);}
      return;
    }
    if (isNode(sel, 'ComplexSelector')) {
      const comps = (sel as ComplexSelector).value;
      if (Array.isArray(comps)) {for (const c of comps) Ruleset.ensureSelectorVisible(c as Selector);}
      return;
    }
    const v = (sel as Selector & { value?: Selector[] }).value;
    if (Array.isArray(v)) {for (const c of v) Ruleset.ensureSelectorVisible(c);}
  }

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
    Ruleset.ensureSelectorVisible(renderSelector);
    const rulesetId = ensureRulesetTraceId(this as unknown as Ruleset);
    if (process.env.DEBUG_FIXTURE_2A) {
    const sourceNode = this.sourceNode;
    const sourceNodeId = sourceNode && isNode(sourceNode, 'Ruleset')
      ? getOptionalRulesetTraceId(sourceNode as Ruleset)
      : undefined;
    syncLog({
        sessionId: 'debug-session',
        runId: process.env.DEBUG_RUN_ID || 'extend-trace',
        hypothesisId: 'H-serialization',
        location: 'ruleset.ts:getHeaderString',
        message: 'header-string',
        data: {
          depth: options.depth,
          selector: renderSelector.valueOf(),
          withoutComments: Boolean(withoutComments),
          rulesetId
        ,
        sourceNodeId
        },
        timestamp: Date.now()
      });
    }
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

      const parentSelector = parentRuleset?.selector;
      // Store own selector before parent resolution so extend can extend .replace,.c not the resolved form.
      if (node.options) {
        (node.options as RulesetOptions).ownSelector = selector;
      } else {
        node.options = { ownSelector: selector } as RulesetOptions;
      }
      if (parentSelector && !(parentSelector instanceof Nil) && !(selector instanceof Nil) && parentRuleset) {
        selector = getImplicitSelectorUtil(selector, parentRuleset as Ruleset, context.opts.collapseNesting);
        selector.sourceNode = node === this ? selector.clone(true) : selector;
      }
      syncLog({
        runId: 'pre',
        hypothesisId: 'ruleset-registry',
        location: 'ruleset.ts:preEval',
        message: 'preEval-node-info',
        data: {
          rulesetId: ensureRulesetTraceId(node as Ruleset),
          parentId: parentRuleset ? ensureRulesetTraceId(parentRuleset as Ruleset) : null,
          isClone: node !== this,
          selector: selector?.valueOf?.() ?? '',
          collapseNesting: Boolean(context.opts?.collapseNesting)
        },
        timestamp: Date.now()
      });
      // DO NOT evaluate guard here - guards are evaluated at call time in getFunctionFromMixins
      // Just evaluate the selector
      return pipe(
        () => selector.eval(context),
        (sel) => {
          // If this ruleset shares its value with a descendant ruleset, give descendants
          // their own value before we overwrite value.selector so they keep their selector.
          Ruleset.ensureDescendantRulesetsHaveOwnValue(node as Ruleset, node.value);
          // Store the evaluated selector - this is what will be in the frame
          node.value.selector = sel as Selector | Nil;
          if (sel.hoistToRoot) {
            node.hoistToRoot = true;
          }
          // Register to extend root's registry for extend lookups
          const extendRoot = context.extendRoots.getCurrentExtendRoot();
          if (extendRoot) {
            extendRoot.getRegistry('ruleset').add(node as Ruleset);
            // Keep a per-root registry list for visibility processing
            registerRulesetWithRoot(extendRoot, node as Ruleset);
            if (Boolean(context.opts?.collapseNesting)) {
              const selVal = typeof (node as Ruleset).value?.selector?.valueOf === 'function' ? (node as Ruleset).value!.selector!.valueOf() : '';
              const isRelevant = selVal === '.ma' || selVal === '.md' || selVal === '';
              if (isRelevant) {
                const valueLen = extendRoot.value?.length ?? 0;
                const first = extendRoot.value?.[0];
                const firstType = first != null && typeof (first as { type?: string }).type === 'string' ? (first as { type: string }).type : undefined;
                const firstRules = first != null && (first as { value?: { rules?: unknown } }).value?.rules;
                const firstValueRulesType = firstRules != null && typeof (firstRules as { type?: string }).type === 'string' ? (firstRules as { type: string }).type : undefined;
                const firstValueRulesLen = firstRules != null && Array.isArray((firstRules as { value?: unknown[] }).value) ? (firstRules as { value: unknown[] }).value.length : undefined;
                syncLog({
                  trace: 'ruleset_register',
                  runId: getExtendTraceRunId(context),
                  collapseNesting: Boolean(context.opts?.collapseNesting),
                  selector: selVal,
                  extendRoot: { valueLen, firstType, firstValueRulesType, firstValueRulesLen }
                });
              }
            }
          }
          // Depth-first: preEval child rules immediately so all nested rulesets/extends
          // are registered in source order before we process extends.
          // Push this ruleset to the frame so nested rulesets get the correct parent selector
          // when building implicit selectors (e.g. .header-nav inside .header → .header .header-nav).
          const childRules = node.value.rules;
          if (childRules && !childRules.preEvaluated) {
            context.rulesetFrames.push(node as Ruleset);
            const preEvaldRules = childRules.preEval(context);
            if (isThenable(preEvaldRules)) {
              return (preEvaldRules as Promise<Rules>).then((rules) => {
                context.rulesetFrames.pop();
                node.value.rules = rules;
                return node;
              });
            }
            context.rulesetFrames.pop();
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

    // Store frames snapshot for collapseNesting serialization
    if (collapseNesting) {
      this.frames = [...context.frames];
    }

    return pipe(
      () => {
        let { guard } = this.value;
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
        const leadingIsResult = processLeadingIs(selector);
        selector = Array.isArray(leadingIsResult)
          ? SelectorList.create(leadingIsResult.map(s => s.copy(true) as Selector)).inherit(selector) as Selector
          : leadingIsResult;
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
        return this.value.rules.eval(context);
      },
      (evaluatedRules: Rules | Nil) => {
        if (pushedFrames) {
          context.rulesetFrames.pop();
          context.frames.pop();
        }
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