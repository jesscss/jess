import { Node, F_VISIBLE, F_AMPERSAND, F_IMPLICIT_AMPERSAND, defineType, type NodeOptions } from './node';
import { type Rules } from './rules';
import type { Context } from '../context';
import { Nil } from './nil';
import type { Condition } from './condition';
import type { Selector } from './selector';
import { atIndex } from './util/collections';
import { isNode } from './util/is-node';
import { Ampersand } from './ampersand';
import { Combinator } from './combinator';
import { ComplexSelector } from './selector-complex';
import { SelectorList } from './selector-list';
import { type PrintOptions, getPrintOptions } from './util/print';
import { type MaybePromise, pipe } from '@jesscss/awaitable-pipe';
import type { AtRule } from './at-rule';

export type RulesetValue = {
  selector: Selector | Nil;
  /**
   * It's important that any Node that defines a Rules
   * sets it to the `rules` property. This allows us to
   * generalize nodes for the `frames` property in Context
   */
  rules: Rules;
  guard?: Condition;
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

  get selector() {
    return this.value.selector;
  }

  /** @todo - remove? */
  override valueOf() {
    return this.selector instanceof Nil ? '' : this.selector.valueOf();
  }

  override toTrimmedString(options?: PrintOptions): string {
    options = getPrintOptions(options);
    const w = options.writer!;
    let { selector, rules } = this.value;
    if (selector instanceof Nil) {
      return '';
    }

    const mark = w.mark();
    if (this.options.hoistToRoot) {
      rules.renderWithFrameFlattening(options, this);
      return w.getSince(mark);
    }

    const selOut = w.capture(() => selector.toTrimmedString(options));
    // Emit selector without trailing whitespace
    w.add(selOut.replace(/\s+$/, ''));
    // Ensure exactly one space before '{'
    w.add(' ');

    rules.toBraced(options);

    return w.getSince(mark);
  }

  /** Render the opening of this ruleset (selector) */
  renderOpening(options: PrintOptions): void {
    const w = options.writer!;
    const { selector } = this.value;
    const depth = options.frameState?.at(-1)?.depth ?? 0;
    const space = ''.padStart(depth * 2);

    if (!(selector instanceof Nil)) {
      const selOut = w.capture(() => selector.toTrimmedString(options));
      w.add(space);
      w.add(selOut.replace(/\s+$/, '').replace(/[ \t]+/g, ' '));
      w.add(' {\n');
    }
  }

  override preEval(context: Context): MaybePromise<this> {
    if (!this.preEvaluated) {
      const node = this.maybeClone(context);
      node.preEvaluated = true;
      node.sourceNode ??= this;
      let { selector } = node.value;
      let parentSelector = context.rulesetFrames.at(-1)?.selector;
      if (parentSelector && !(parentSelector instanceof Nil)) {
        selector = node.getImplicitSelector(parentSelector, context.opts.collapseNesting);
        selector.sourceNode = node === this ? selector.clone(true) : selector;
      }
      return pipe(
        () => selector.eval(context),
        (sel) => {
          node.value.selector = sel as Selector | Nil;
          return node;
        }
      );
    }
    return this;
  }

  addImplicitAmpersand(parentSelector: Selector, selector: Selector, collapseNesting = false): Selector {
    if (selector.hasFlag(F_AMPERSAND)) {
      return selector;
    }
    let amp = Ampersand.create({});
    // Mark as implicit so it can be excluded from visibleKeySet for indexing
    amp.addFlag(F_IMPLICIT_AMPERSAND);
    if (!collapseNesting) {
      amp.removeFlag(F_VISIBLE);
    }
    let comb = Combinator.create(' ');
    if (!collapseNesting) {
      comb.removeFlag(F_VISIBLE);
    }
    if (selector instanceof ComplexSelector) {
      if (selector.value[0] instanceof Combinator) {
        return ComplexSelector.create([amp, ...selector.value]).inherit(selector);
      }
      return ComplexSelector.create([amp, comb, ...selector.value]).inherit(selector);
    }
    const returnVal = ComplexSelector.create([amp, comb, selector]).inherit(selector);
    return returnVal;
  }

  /** Attach an (invisible) ampersand to the selector(s) if it's not already there */
  getImplicitSelector(parentSelector: Selector, collapseNesting = false) {
    let selector = this.selector;
    if (selector instanceof Nil) {
      return selector;
    }
    if (selector instanceof SelectorList) {
      let mutated = false;
      for (let i = 0; i < (selector as SelectorList).value.length; i++) {
        let sel = (selector as SelectorList).value[i]!;
        let result = this.addImplicitAmpersand(parentSelector, sel, collapseNesting);
        if (result !== sel) {
          if (!mutated) {
            selector = selector.clone(true);
          }
          (selector as SelectorList).value[i] = result;
          mutated = true;
        }
      }
    } else {
      selector = this.addImplicitAmpersand(parentSelector, selector, collapseNesting);
    }
    if (collapseNesting) {
      selector.options.hoistToRoot = true;
    }
    return selector;
  }

  override copy(deep?: boolean): this {
    const node = super.copy(deep);
    const selectorSourceNode = this.value.selector.sourceNode;
    node.value.selector = selectorSourceNode.copy(true) as Selector | Nil;
    node.value.selector.sourceNode = selectorSourceNode;
    return node;
  }

  override evalNode(context: Context): MaybePromise<Ruleset | Nil> {
    // #region agent log
    const rulesetId = `${this.index ?? '?'}`;
    fetch('http://127.0.0.1:7244/ingest/c37d62a7-1368-4631-9d3b-7a2281954bfc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'ruleset.ts:186', message: 'Ruleset.evalNode entry', data: { rulesetIndex: this.index, evaluated: this.evaluated, framesDepth: context.rulesetFrames.length }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'B' }) }).catch(() => {});
    // #endregion

    if (this.evaluated) {
      // #region agent log
      fetch('http://127.0.0.1:7244/ingest/c37d62a7-1368-4631-9d3b-7a2281954bfc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'ruleset.ts:190', message: 'Ruleset.evalNode already evaluated', data: { rulesetIndex: this.index }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'A' }) }).catch(() => {});
      // #endregion
      return this;
    }
    /** Should have been maybe cloned in preEval */
    this.evaluated = true;
    let frame = atIndex(context.rulesetFrames, -1);
    // if (frame && isNode(frame.selector, 'Selector')) {
    //   rule.parentSelector = frame.selector;
    // }
    let guard = this.value.guard;
    const collapseNesting = context.opts.collapseNesting;

    // Store frames snapshot for collapseNesting serialization
    if (collapseNesting) {
      this.frames = [...context.frames];
    }

    return pipe(
      () => {
        return guard?.eval(context);
      },
      (guard) => {
        if (guard && !guard.value) {
          // #region agent log
          fetch('http://127.0.0.1:7244/ingest/c37d62a7-1368-4631-9d3b-7a2281954bfc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'ruleset.ts:217', message: 'Ruleset guard failed', data: { rulesetIndex: this.index }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'B' }) }).catch(() => {});
          // #endregion
          return new Nil();
        }
        this.value.guard = undefined;
        return this.selector.eval(context);
      },
      (sels: Selector | Nil) => {
        if (frame && (this.options.hoistToRoot ?? context.opts.collapseNesting)) {
          this.options.hoistToRoot = true;
        }
        // Unwrap generated :is() pseudo-selectors if they're the ruleset's only selector
        // or if they're the first component of a ComplexSelector in the parent
        if (
          isNode(sels, 'PseudoSelector')
          && sels.value.name === ':is'
          && sels.generated
        ) {
          // Check if this :is() is the first component of a ComplexSelector in the parent
          const parent = context.rulesetFrames[context.rulesetFrames.length - 1];
          if (parent && parent.value && parent.value.selector) {
            const parentSelector = parent.value.selector;
            if (isNode(parentSelector, 'ComplexSelector') && parentSelector.value[0] === sels) {
              // This :is() is the first component of the parent's ComplexSelector, so unwrap it
              sels = sels.value.arg as Selector;
            } else {
              // This :is() is the ruleset's only selector (not part of a SelectorList), so unwrap it
              sels = sels.value.arg as Selector;
            }
          } else {
            // No parent, so this :is() is the ruleset's only selector, unwrap it
            sels = sels.value.arg as Selector;
          }
        }

        // Also check if the selector is a ComplexSelector that contains a :is() as its first component
        if (isNode(sels, 'ComplexSelector')) {
          if (
            isNode(sels.value[0], 'PseudoSelector')
            && sels.value[0].value.name === ':is'
            && sels.value[0].generated
          ) {
            // Only unwrap if the :is() contains a ComplexSelector, not a SelectorList
            const unwrappedSelector = sels.value[0].value.arg as Selector;
            if (isNode(unwrappedSelector, 'ComplexSelector')) {
              // Replace the first component with the unwrapped selector
              const newComponents = [unwrappedSelector, ...sels.value.slice(1)];
              sels = ComplexSelector.create(newComponents);
            }
          }
        }

        // Unwrap generated :is() if it's the only component of a CompoundSelector
        if (isNode(sels, 'CompoundSelector') && sels.value.length === 1) {
          const onlyComponent = sels.value[0];
          if (
            isNode(onlyComponent, 'PseudoSelector')
            && onlyComponent.value.name === ':is'
            && onlyComponent.generated
          ) {
            // Unwrap the :is() - use its argument as the selector
            sels = onlyComponent.value.arg as Selector;
          }
        }
        if (sels instanceof Nil) {
          return sels;
        }
        // Preserve the sourceNode from the current selector before replacing it
        const preservedSourceNode = this.value.selector?.sourceNode;
        this.value.selector = sels;
        // Restore the sourceNode on the new selector so it's available when copying
        if (preservedSourceNode && this.value.selector) {
          this.value.selector.sourceNode = preservedSourceNode;
        }
        this.options.hoistToRoot ||= context.opts.collapseNesting;
        // #region agent log
        const framesDepthBefore = context.rulesetFrames.length;
        fetch('http://127.0.0.1:7244/ingest/c37d62a7-1368-4631-9d3b-7a2281954bfc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'ruleset.ts:293', message: 'Ruleset pushing frame', data: { rulesetIndex: this.index, framesDepthBefore, rulesCount: this.value.rules.value.length }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'B' }) }).catch(() => {});
        // #endregion
        context.rulesetFrames.push(this as Ruleset);
        context.frames.push(this);
        return this.value.rules.eval(context);
      },
      (evaluatedRules: Rules | Nil) => {
        // #region agent log
        const framesDepthBefore = context.rulesetFrames.length;
        fetch('http://127.0.0.1:7244/ingest/c37d62a7-1368-4631-9d3b-7a2281954bfc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'ruleset.ts:300', message: 'Ruleset popping frame', data: { rulesetIndex: this.index, framesDepthBefore }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'B' }) }).catch(() => {});
        // #endregion
        // ALWAYS pop the frame, even if evaluatedRules is Nil, to prevent frame accumulation
        context.rulesetFrames.pop();
        context.frames.pop();

        if (evaluatedRules instanceof Nil) {
          return evaluatedRules;
        }
        this.value.rules = evaluatedRules;
        const rules = this.value.rules;

        // Don't remove visibility flag when collapseNesting is enabled
        // because the ruleset will be flattened to root level
        // Also don't remove it if the ruleset has a selector - empty rulesets should still be output
        // (e.g., when a mixin guard doesn't match, the ruleset should still appear, just empty)
        if (rules.visibleRules().length === 0 && collapseNesting) {
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