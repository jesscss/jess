import { Node, defineType, type NodeOptions } from './node';
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

  override stateRules = ['visible', 'evaluated', 'preEvaluated', 'parentSelector'];
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
    const beforeSel = w.mark();
    // Emit selector without outer pre/post to avoid inherited blank lines
    selector.toTrimmedString(options);
    const selOut = w.getSince(beforeSel);
    if (!/\s$/.test(selOut)) {
      w.add(' ');
    }
    // rules.toBraced needs depth updates
    const depth = (options.depth ?? 0);
    // Emit rules with braces; inner body should not start with an extra newline
    rules.toBraced(depth, { ...options, suppressLeadingNewline: true });
    return w.getSince(mark);
  }

  override async preEval(context: Context): Promise<this> {
    if (!this.preEvaluated) {
      let node = this.maybeClone(context);
      node.preEvaluated = true;
      node.sourceNode ??= this;
      let { selector } = node.value;
      node.value.selector = await selector.eval(context) as Selector | Nil;
      return node;
    }
    return this;
  }

  /** Attach an (invisible) ampersand to the selector(s) if it's not already there */
  getImplicitSelector() {
    if (!this.parentSelector) {
      return this.selector;
    }

    const selector = this.selector;
    if (selector instanceof Nil) {
      return selector;
    }
    const invisibleAmp = new Ampersand({ selector: this.parentSelector });
    invisibleAmp.visible = false;
    const invisibleCombinator = new Combinator(' ');
    invisibleCombinator.visible = false;

    // Helper to check for ampersand in a selector's nodes
    const hasAmpersand = (sel: Selector) => {
      for (const node of sel.nodes()) {
        if (isNode(node, 'Ampersand')) return true;
      }

      return false;
    };

    // If selector is a SelectorList, process each item
    if (isNode(selector, 'SelectorList')) {
      const newList = selector.value.map((sel) => {
        if (hasAmpersand(sel)) {
          return sel;
        }
        if (isNode(sel, 'CompoundSelector') || isNode(sel, 'SimpleSelector')) {
          return ComplexSelector.create([invisibleAmp, invisibleCombinator, sel]);
        }
        if (isNode(sel, 'ComplexSelector')) {
          const cloned = sel.clone(true);
          cloned.value.unshift(invisibleAmp, invisibleCombinator);
          return cloned;
        }
        return sel;
      });
      return SelectorList.create(newList);
    }

    // If selector is not a list, check for ampersand
    if (hasAmpersand(selector)) {
      return selector;
    }
    if (isNode(selector, 'CompoundSelector') || isNode(selector, 'SimpleSelector')) {
      return ComplexSelector.create([invisibleAmp, invisibleCombinator, selector]);
    }
    if (isNode(selector, 'ComplexSelector')) {
      const cloned = selector.clone(true);
      cloned.value.unshift(invisibleAmp, invisibleCombinator);
      return cloned;
    }
    return selector;
  }

  override async evalNode(context: Context): Promise<Ruleset | Nil> {
    let rule = this.maybeClone(context);
    rule.options = { ...this.options };
    let frame = atIndex(context.rulesetFrames, -1);
    /** Store the current frame selector if we need it for serialization */
    if (frame && isNode(frame.selector, 'Selector')) {
      rule.parentSelector = frame.selector;
    }
    let guard = rule.value.guard;
    if (guard) {
      let bool = await guard.eval(context);
      if (!bool.value) {
        return new Nil();
      }
      /** Remove once evaluated */
      rule.value.guard = undefined;
    }
    /** Allow a selector to signal that nesting should be collapsed */
    const collapseNesting = context.opts.collapseNesting;
    let sels = (await this.selector.eval(context)) as Selector | Nil;

    if (frame && (this.options.hoistToRoot ?? context.opts.collapseNesting)) {
      rule.options.hoistToRoot = true;
    }
    context.opts.collapseNesting = collapseNesting;

    /** If the only selector is a generated :is, unwrap it */
    if (
      isNode(sels, 'PseudoSelector')
      && sels.value.name === ':is'
      && sels.generated
    ) {
      sels = sels.value.arg as Selector;
    }

    if (sels instanceof Nil) {
      return sels;
    }

    rule.value.selector = sels;

    context.rulesetFrames.push(rule);
    rule.value.rules = await this.value.rules.eval(context);
    context.rulesetFrames.pop();

    /** Remove empty rules */
    const rules = rule.value.rules;
    if (rules.visibleRules().length === 0) {
      rule.visible = false;
    }
    return rule;
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