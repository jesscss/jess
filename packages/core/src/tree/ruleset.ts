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
    const originalSelector = node.value.selector;
    const selectorSourceNode = originalSelector?.sourceNode;
    if (originalSelector && selectorSourceNode) {
      node.value.selector = selectorSourceNode.copy(true) as Selector | Nil;
    }
    return node;
  }

  override evalNode(context: Context): MaybePromise<Ruleset | Nil> {
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

        // Always use getImplicitSelector when there's a parent selector
        // BUT: if the parent Ruleset in frames is the same instance/index as this Ruleset,
        // we should not use it as the parent (to prevent infinite recursion)
        const parentFrame = atIndex(context.rulesetFrames, -1);
        const isParentSameRuleset = parentFrame && (parentFrame === this || parentFrame.index === this.index);
        if (parentSelector && !(parentSelector instanceof Nil) && !isParentSameRuleset) {
          const result = this.getImplicitSelector(parentSelector, collapseNesting);
          /** Store the implicit ampersand with the selector */
          this.value.selector.sourceNode = result;
          return result.eval(context);
        } else {
          // No parent selector, so just return the selector as-is (no evaluation needed)
          return this.selector;
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
        // Preserve the sourceNode from the current selector before replacing it
        const preservedSourceNode = this.value.selector?.sourceNode;
        this.value.selector = sels;
        // Restore the sourceNode on the new selector so it's available when copying
        if (preservedSourceNode && this.value.selector) {
          this.value.selector.sourceNode = preservedSourceNode;
        }
        this.options.hoistToRoot ||= context.opts.collapseNesting;
        context.rulesetFrames.push(this as Ruleset);
        context.frames.push(this);
        return this.value.rules.eval(context);
      },
      (evaluatedRules: Rules | Nil) => {
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