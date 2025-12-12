import { Node, F_VISIBLE, F_AMPERSAND, defineType, type NodeOptions } from './node';
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
import { CompoundSelector } from './selector-compound';
import { sel } from './selector-complex';
import { amp } from './ampersand';
import { co } from './combinator';
import { type PrintOptions, getPrintOptions } from './util/print';
import { type MaybePromise, pipe } from '@jesscss/awaitable-pipe';
import type { AtRule } from './at-rule';
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';

// Debug logging helper
const debugLog = (location: string, message: string, data: any, hypothesisId: string) => {
  try {
    const logPath = join(__dirname, '../../../../.cursor/debug.log');
    const logEntry = JSON.stringify({
      location,
      message,
      data,
      timestamp: Date.now(),
      sessionId: 'debug-session',
      runId: 'run1',
      hypothesisId
    }) + '\n';
    appendFileSync(logPath, logEntry);
  } catch (e) {
    // Ignore logging errors
  }
};

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
      w.add(selOut.replace(/\s+$/, ''));
      w.add(' {\n');
    }
  }

  override preEval(context: Context): MaybePromise<this> {
    if (!this.preEvaluated) {
      const node = this.maybeClone(context);
      // #region agent log
      const selectorValue = node.value.selector?.valueOf();
      const isChips = selectorValue === '.chips' || selectorValue?.includes('.chips');
      if (isChips) {
        const stackTrace = new Error().stack;
        const callerInfo = stackTrace?.split('\n').slice(1, 5).join(' | ') || 'no-stack';
        debugLog('ruleset.ts:129', 'Cloning Ruleset with .chips selector in preEval', {
          selectorValue,
          rulesetIndex: node.index,
          originalIndex: this.index,
          isSameInstance: node === this,
          callerInfo,
          note: 'tracking when .chips Ruleset is cloned'
        }, 'H');
      }
      // #endregion
      node.preEvaluated = true;
      node.sourceNode ??= this;
      const { selector } = node.value;
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
    let amp = Ampersand.create({ selector: parentSelector.copy(true) });
    if (!collapseNesting) {
      amp.removeFlag(F_VISIBLE);
    }
    let comb = Combinator.create(' ');
    if (!collapseNesting) {
      comb.removeFlag(F_VISIBLE);
    }
    if (selector instanceof ComplexSelector) {
      return ComplexSelector.create([amp, comb, ...selector.value]).inherit(selector);
    }
    return ComplexSelector.create([amp, comb, selector]).inherit(selector);
  }

  /** Attach an (invisible) ampersand to the selector(s) if it's not already there */
  getImplicitSelector(parentSelector: Selector, collapseNesting = false) {
    let selector = this.selector;
    // #region agent log - track implicit ampersand for .chips
    const currentSelectorValue = selector?.valueOf();
    const parentSelectorValue = parentSelector?.valueOf();
    const isChips = currentSelectorValue === '.chips' || (typeof currentSelectorValue === 'string' && currentSelectorValue.includes('.chips'));
    if (isChips) {
      debugLog('ruleset.ts:179', 'getImplicitSelector called on .chips Ruleset', {
        currentSelectorValue,
        parentSelectorValue,
        rulesetIndex: this.index,
        rulesetEvaluated: this.evaluated,
        collapseNesting,
        note: 'checking if implicit ampersand is mutating .chips selector'
      }, 'H');
    }
    // #endregion
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
    // #region agent log - track result of implicit ampersand for .chips
    if (isChips) {
      const resultSelectorValue = selector?.valueOf();
      debugLog('ruleset.ts:204', 'getImplicitSelector result for .chips', {
        resultSelectorValue,
        wasMutated: resultSelectorValue !== currentSelectorValue,
        rulesetIndex: this.index,
        note: 'checking if selector was mutated by implicit ampersand'
      }, 'H');
    }
    // #endregion
    if (collapseNesting) {
      selector.options.hoistToRoot = true;
    }
    return selector;
  }

  override evalNode(context: Context): MaybePromise<Ruleset | Nil> {
    // #region agent log
    const currentSelector = this.selector?.valueOf();
    const isChips = currentSelector === '.chips' || (typeof currentSelector === 'string' && currentSelector.includes('.chips'));
    if (isChips) {
      const rulesetIndex = this.index;
      const stackTrace = new Error().stack;
      const callerInfo = stackTrace?.split('\n').slice(1, 4).join(' | ') || 'no-stack';
      const alreadyInFrames = context.rulesetFrames.some(f => f === this);
      const framesWithChips = context.rulesetFrames.filter((f) => {
        const sel = f.selector?.valueOf();
        return sel === '.chips' || (typeof sel === 'string' && sel.includes('.chips'));
      });
      const framesWithChipsInfo = framesWithChips.map((f) => {
        const sel = f.selector?.valueOf();
        return {
          stackIndex: context.rulesetFrames.indexOf(f),
          frameIndex: f.index,
          isSameRef: f === this,
          frameSelector: sel,
          frameSelectorIncludesChips: sel === '.chips' || (typeof sel === 'string' && sel.includes('.chips'))
        };
      });
      debugLog('ruleset.ts:232', 'Evaluating .chips Ruleset', {
        currentSelector,
        rulesetIndex,
        rulesetEvaluated: this.evaluated,
        alreadyInFrames,
        framesWithChipsCount: framesWithChips.length,
        framesWithChipsInfo,
        callerInfo,
        rulesetFramesLength: context.rulesetFrames.length,
        note: 'tracking if .chips is evaluated twice or selector is mutated'
      }, 'H');
    }
    // #endregion
    if (this.evaluated) {
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
      () => guard?.eval(context),
      (guard) => {
        if (guard && !guard.value) {
          return new Nil();
        }
        this.value.guard = undefined;
        let parentSelector = context.rulesetFrames.at(-1)?.selector;
        // #region agent log
        const currentRulesetSelector = this.selector?.valueOf();
        const rulesetFramesInfo = context.rulesetFrames.map((f, i) => ({
          index: i,
          selector: f.selector?.valueOf(),
          type: f.type
        }));
        const parentSelectorValueOf = parentSelector && !(parentSelector instanceof Nil) ? parentSelector.valueOf() : undefined;
        debugLog('ruleset.ts:190', 'Getting parentSelector from rulesetFrames', { currentRulesetSelector, rulesetFramesLength: context.rulesetFrames.length, rulesetFramesInfo, parentSelectorValueOf, note: 'checking if rulesetFrames has wrong entries' }, 'H');
        // #endregion

        // Always use getImplicitSelector when there's a parent selector
        // BUT: if the parent Ruleset in frames is the same instance/index as this Ruleset,
        // we should not use it as the parent (to prevent infinite recursion)
        const parentFrame = atIndex(context.rulesetFrames, -1);
        const isParentSameRuleset = parentFrame && (parentFrame === this || parentFrame.index === this.index);
        if (parentSelector && !(parentSelector instanceof Nil) && !isParentSameRuleset) {
          const result = this.getImplicitSelector(parentSelector, collapseNesting);
          return result.eval(context);
        } else {
          return this.selector.eval(context);
        }
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
        // #region agent log - track selector assignment for .chips
        const beforeSelectorValue = this.selector?.valueOf();
        const newSelectorValue = sels?.valueOf();
        const isChips = beforeSelectorValue === '.chips' || (typeof beforeSelectorValue === 'string' && beforeSelectorValue.includes('.chips'))
          || newSelectorValue === '.chips' || (typeof newSelectorValue === 'string' && newSelectorValue.includes('.chips'));
        if (isChips) {
          debugLog('ruleset.ts:340', 'Assigning selector to .chips Ruleset', {
            beforeSelectorValue,
            newSelectorValue,
            rulesetIndex: this.index,
            rulesetEvaluated: this.evaluated,
            isSameInstance: this.selector === sels,
            note: 'checking if selector is being mutated on .chips Ruleset'
          }, 'H');
        }
        // #endregion
        this.value.selector = sels;
        this.options.hoistToRoot ||= context.opts.collapseNesting;
        context.rulesetFrames.push(this as Ruleset);
        context.frames.push(this);
        return this.value.rules.eval(context);
      },
      (evaluatedRules: Rules | Nil) => {
        const currentRulesetIndex = this.index;
        // #region agent log
        const framesBeforePop = context.rulesetFrames.map((f, i) => ({
          index: i,
          selector: f.selector?.valueOf(),
          type: f.type
        }));
        const expectedPoppedSelector = this.selector?.valueOf();
        const actualTopFrameSelector = framesBeforePop.length > 0 ? framesBeforePop[framesBeforePop.length - 1]?.selector : undefined;
        const isNil = evaluatedRules instanceof Nil;
        debugLog('ruleset.ts:306', 'About to pop Ruleset from rulesetFrames', { expectedPoppedSelector, actualTopFrameSelector, framesBeforePopLength: context.rulesetFrames.length, framesBeforePop, isNil, note: 'popping Ruleset from frames' }, 'H');
        // #endregion

        // ALWAYS pop the frame, even if evaluatedRules is Nil, to prevent frame accumulation
        // #region agent log
        const poppedRulesetSelector = framesBeforePop.length > 0 ? framesBeforePop[framesBeforePop.length - 1]?.selector : undefined;
        debugLog('ruleset.ts:318', 'Popping Ruleset from rulesetFrames', { poppedRulesetSelector, expectedPoppedSelector, framesBeforePopLength: context.rulesetFrames.length, framesBeforePop, isNil, note: 'always popping to prevent frame leak' }, 'H');
        // #endregion
        context.rulesetFrames.pop();
        context.frames.pop();

        if (evaluatedRules instanceof Nil) {
          return evaluatedRules;
        }
        this.value.rules = evaluatedRules;
        const rules = this.value.rules;

        // Don't remove visibility flag when collapseNesting is enabled
        // because the ruleset will be flattened to root level
        if (rules.visibleRules().length === 0 && !collapseNesting) {
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