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

    // If collapseNesting is enabled, we need to flatten nested rulesets
    if (options.collapseNesting) {
      return this.toFlattenedString(options);
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

  /**
   * Output flattened CSS when collapseNesting is enabled
   * This creates separate rulesets for each nested level instead of nesting
   */
  private toFlattenedString(options: PrintOptions): string {
    const w = options.writer!;
    const { selector, rules } = this.value;

    // Output the current ruleset first
    const mark = w.mark();
    const selOut = w.capture(() => selector.toTrimmedString(options));
    w.add(selOut.replace(/\s+$/, ''));
    w.add(' ');

    // Emit only declarations in this block
    const depth = (options.depth ?? 0);
    const declOnly = rules.clone();
    declOnly.value = rules.value.filter((r: any) => r && r.type === 'Declaration');
    if (declOnly.value.length > 0) {
      declOnly.toBraced(depth, options);
    } else {
      // Still emit empty braces if no declarations? For now, emit empty block
      // to preserve structure
      declOnly.toBraced(depth, options);
    }

    // Now, emit each nested ruleset as a sibling with the already-evaluated selector
    const childOptions = { ...options, collapseNesting: false } as PrintOptions;
    for (const child of rules.value) {
      if (child && child.type === 'Ruleset') {
        w.add('\n');
        const childSelOut = w.capture(() => (child as any).value.selector.toTrimmedString(childOptions));
        w.add(childSelOut.replace(/\s+$/, ''));
        w.add(' ');

        // For nested rulesets, we need to recursively flatten them
        if (options.collapseNesting) {
          // Output only declarations from this nested ruleset
          const nestedDeclOnly = (child as any).value.rules.clone();
          nestedDeclOnly.value = (child as any).value.rules.value.filter((r: any) => r && r.type === 'Declaration');
          if (nestedDeclOnly.value.length > 0) {
            nestedDeclOnly.toBraced(depth, childOptions);
          } else {
            // Still emit empty braces if no declarations
            nestedDeclOnly.toBraced(depth, childOptions);
          }

          // Now recursively process any deeper nested rulesets
          for (const nestedChild of (child as any).value.rules.value) {
            if (nestedChild && nestedChild.type === 'Ruleset') {
              w.add('\n');
              const nestedSelOut = w.capture(() => nestedChild.value.selector.toTrimmedString(childOptions));
              w.add(nestedSelOut.replace(/\s+$/, ''));
              w.add(' ');

              // Output only declarations from the deeper nested ruleset
              const deeperDeclOnly = nestedChild.value.rules.clone();
              deeperDeclOnly.value = nestedChild.value.rules.value.filter((r: any) => r && r.type === 'Declaration');
              if (deeperDeclOnly.value.length > 0) {
                deeperDeclOnly.toBraced(depth, childOptions);
              } else {
                // Still emit empty braces if no declarations
                deeperDeclOnly.toBraced(depth, childOptions);
              }
            }
          }
        } else {
          // Just output the rules normally
          (child as any).value.rules.toBraced(depth, childOptions);
        }
      }
    }

    return w.getSince(mark);
  }

  /**
   * Get all rules from this ruleset, separating declarations from nested rulesets
   */
  // Removed helper that tried to collect and rewrite; we emit directly from children

  /**
   * Create a flattened selector by replacing invisible ampersands with the current selector
   */
  // Removed string-based ampersand replacement; selectors are already resolved in AST

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

  /** Attach an (invisible) ampersand to the selector(s) if it's not already there */
  getImplicitSelector(collapseNesting = false) {
    if (!this.parentSelector) {
      return this.selector;
    }

    const selector = this.selector;
    if (selector instanceof Nil) {
      return selector;
    }
    const invisibleAmp = new Ampersand({ selector: this.parentSelector });
    if (!collapseNesting) {
      invisibleAmp.removeFlag(F_VISIBLE);
    }
    const invisibleCombinator = new Combinator(' ');
    if (!collapseNesting) {
      invisibleCombinator.removeFlag(F_VISIBLE);
    }

    // Helper to check for ampersand in a selector's nodes
    const hasAmpersand = (sel: Selector) => sel.hasFlag(F_AMPERSAND);

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
          const cloned = (sel as ComplexSelector).clone(true);
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
      const cloned = (selector as ComplexSelector).clone(true);
      cloned.value.unshift(invisibleAmp, invisibleCombinator);
      return cloned;
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
    return pipe(
      () => guard?.eval(context),
      (guard) => {
        if (guard && !guard.value) {
          return new Nil();
        }
        rule.value.guard = undefined;

        // Always use getImplicitSelector when there's a parent selector
        if (rule.parentSelector) {
          return rule.getImplicitSelector(collapseNesting).eval(context);
        } else {
          return rule.selector.eval(context);
        }
      },
      (sels: Selector | Nil) => {
        if (frame && (this.options.hoistToRoot ?? context.opts.collapseNesting)) {
          rule.options.hoistToRoot = true;
        }
        context.opts.collapseNesting = collapseNesting;
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
        return this.value.rules.eval(context);
      },
      (evaluatedRules: Rules | Nil) => {
        if (evaluatedRules instanceof Nil) {
          return evaluatedRules;
        }
        context.rulesetFrames.pop();
        rule.value.rules = evaluatedRules;
        const rules = rule.value.rules;
        if (rules.visibleRules().length === 0) {
          rule.removeFlag(F_VISIBLE);
        }
        return rule;
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