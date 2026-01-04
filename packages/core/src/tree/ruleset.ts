import { Node, F_VISIBLE, F_AMPERSAND, F_IMPLICIT_AMPERSAND, defineType, type NodeOptions } from './node';
import { Rules } from './rules';
import type { Context } from '../context';
import { Nil } from './nil';
import type { Condition } from './condition';
import type { Selector } from './selector';
import { atIndex } from './util/collections';
import { isNode } from './util/is-node';
import { Ampersand } from './ampersand';
import { Combinator } from './combinator';
import { ComplexSelector, type ComplexSelectorComponent } from './selector-complex';
import type { CompoundSelector } from './selector-compound';
import { SelectorList } from './selector-list';
import { type PrintOptions, type FinalPrintOptions, getPrintOptions } from './util/print';
import { type MaybePromise, pipe, isThenable } from '@jesscss/awaitable-pipe';
import type { AtRule } from './at-rule';
import { serializeRulesContainer, normalizeIndent, indent } from './util/serialize-helper';

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
    let { selector } = this.value;
    const idt = indent(options.depth);

    if (withoutComments) {
      selector = selector.copy(true) as Selector;
    }

    let out = withoutComments ? '' : w.capture(() => this.processPrePost('pre', undefined, options));
    let selOut = w.capture(() => selector.toString(options));
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
      let { selector, rules } = node.value;
      if (context.leakyRules) {
        rules.options.rulesVisibility.Mixin = 'public';
        rules.options.rulesVisibility.VarDeclaration = 'optional';
      } else {
        rules.options.rulesVisibility.Mixin = 'private';
        rules.options.rulesVisibility.VarDeclaration = 'private';
      }
      let parentSelector = context.rulesetFrames.at(-1)?.selector;
      if (parentSelector && !(parentSelector instanceof Nil)) {
        selector = node.getImplicitSelector(parentSelector, context.opts.collapseNesting);
        selector.sourceNode = node === this ? selector.clone(true) : selector;
      }
      return pipe(
        () => selector.eval(context),
        (sel) => {
          node.value.selector = sel as Selector | Nil;
          if (sel.hoistToRoot) {
            node.hoistToRoot = true;
          }
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
      selector.hoistToRoot = true;
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
    if (this.evaluated) {
      return this;
    }
    let pushedFrames = false;
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
          const n = new Nil();
          this.value.guard = n;
          return n;
        }
        this.value.guard = undefined;
        return this.selector.eval(context);
      },
      (sels: Selector | Nil) => {
        if (this.value.guard instanceof Nil) {
          return this.value.guard;
        }
        if (frame && (this.hoistToRoot ?? context.opts.collapseNesting)) {
          this.hoistToRoot = true;
        }
        // Unwrap generated :is() pseudo-selectors if they're the ruleset's only selector
        // or if they're the first component of a ComplexSelector in the parent
        if (
          isNode(sels, 'PseudoSelector')
          && sels.value.name === ':is'
          && sels.generated
        ) {
          sels = sels.value.arg as Selector;
        }

        // Also check if the selector is a ComplexSelector that contains a :is() as its first component
        if (isNode(sels, 'ComplexSelector')) {
          let first = sels.value[0];
          let outer: ComplexSelector | CompoundSelector = sels;
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
        if (isNode(sels, 'CompoundSelector')) {
          const first = sels.value[0];
          if (
            isNode(first, 'PseudoSelector')
            && first.value.name === ':is'
            && first.generated
            && first.value.arg!.type !== 'SelectorList'
          ) {
            // Unwrap the :is() - use its argument as the selector
            if (sels.value.length === 1) {
              sels = sels.value[0]!;
            } else {
              sels.value[0] = first.value.arg! as ComplexSelectorComponent;
            }
          }
        }
        if (sels instanceof Nil) {
          // If selector evaluates to Nil, return the rules body directly instead of the ruleset
          // This allows rules to be output even when there's no selector context
          // We don't push frames because there's no selector context
          // Store Nil in selector so next step can detect this case
          this.value.selector = sels;
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
        this.value.selector = sels;
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
          return evaluatedRules as any;
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