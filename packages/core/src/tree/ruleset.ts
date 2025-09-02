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
import { sel } from './selector-complex';
import { amp } from './ampersand';
import { co } from './combinator';
import { type PrintOptions, getPrintOptions } from './util/print';
import { type MaybePromise, pipe } from '@jesscss/awaitable-pipe';

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

  parentSelector: Selector | undefined;

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
    // Capture selector output to normalize only trailing space before '{'
    const selOut = w.capture(() => selector.toTrimmedString(options));
    // Emit selector without trailing whitespace
    w.add(selOut.replace(/\s+$/, ''));
    // Ensure exactly one space before '{'
    w.add(' ');
    // rules.toBraced needs depth updates
    const depth = (options.depth ?? 0);
    // Emit rules with braces using parent-managed newlines/indents
    rules.toBraced(depth, options);
    return w.getSince(mark);
  }

  /** @todo - remove? */
  override inherit(node: Node) {
    let n = super.inherit(node);
    n.parentSelector = this.parentSelector;
    return n;
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
    let amp = Ampersand.create({ selector: parentSelector });
    if (collapseNesting) {
      amp.removeFlag(F_VISIBLE);
    }
    let comb = Combinator.create(' ');
    if (collapseNesting) {
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
      selector.value = selector.value.map(sel => this.addImplicitAmpersand(parentSelector, sel, collapseNesting));
    } else {
      selector = this.addImplicitAmpersand(parentSelector, selector, collapseNesting);
    }
    if (collapseNesting) {
      selector.options.hoistToRoot = true;
    }
    return selector;
  }

  override evalNode(context: Context): MaybePromise<Ruleset | Nil> {
    let rule = this;
    rule.options = { ...this.options };
    let frame = atIndex(context.rulesetFrames, -1);
    if (frame && isNode(frame.selector, 'Selector')) {
      rule.parentSelector = frame.selector;
    }
    let guard = rule.value.guard;
    const collapseNesting = context.opts.collapseNesting;

    // Store frames snapshot for collapseNesting serialization
    if (collapseNesting) {
      (rule as any).frames = [...context.frames];
    }
    return pipe(
      () => guard?.eval(context),
      (guard) => {
        if (guard && !guard.value) {
          return new Nil();
        }
        rule.value.guard = undefined;
        let parentSelector = context.rulesetFrames.at(-1)?.selector;

        // Always use getImplicitSelector when there's a parent selector
        if (parentSelector && !(parentSelector instanceof Nil)) {
          const result = rule.getImplicitSelector(parentSelector, collapseNesting);
          return result.eval(context);
        } else {
          return rule.selector.eval(context);
        }
      },
      (sels: Selector | Nil) => {
        if (frame && (this.options.hoistToRoot ?? context.opts.collapseNesting)) {
          this.options.hoistToRoot = true;
        }
        // Unwrap generated :is() pseudo-selectors if they're the first component of a ComplexSelector
        if (
          isNode(sels, 'PseudoSelector')
          && sels.value.name === ':is'
          && sels.generated
        ) {
          // Check if this :is() is the first component of a ComplexSelector
          const parent = context.rulesetFrames[context.rulesetFrames.length - 1];
          if (parent && parent.value && parent.value.selector) {
            const parentSelector = parent.value.selector;
            if (isNode(parentSelector, 'ComplexSelector') && parentSelector.value[0] === sels) {
              // This :is() is the first component, so unwrap it
              sels = sels.value.arg as Selector;
            }
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
        if (sels instanceof Nil) {
          return sels;
        }
        rule.value.selector = sels;
        context.rulesetFrames.push(rule);
        context.frames.push(rule as any);
        return this.value.rules.eval(context);
      },
      (evaluatedRules: Rules | Nil) => {
        if (evaluatedRules instanceof Nil) {
          return evaluatedRules;
        }

        context.rulesetFrames.pop();
        context.frames.pop();
        rule.value.rules = evaluatedRules;
        const rules = rule.value.rules;

        if (rules.visibleRules().length === 0) {
          rule.removeFlag(F_VISIBLE);
        }

        return rule as any;
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