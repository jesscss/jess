import { Node, defineType } from './node';
import { ComplexSelector } from './selector-complex';
import { Ampersand } from './ampersand';
import { Ruleset } from './ruleset';
import type { General } from './general';
import { Rules } from './rules';
import type { Context } from '../context';
import { type PrintOptions, getPrintOptions } from './util/print';

export type AtRuleValue = {
  name: General<'Name'>;
  /** The prelude */
  prelude?: Node;
  rules?: Rules;
};

/**
 * A rule like @charset or @media
 */
export class AtRule extends Node<AtRuleValue> {
  type = 'AtRule' as const;
  shortType = 'atrule' as const;
  override allowRoot = true;

  override toTrimmedString(options?: PrintOptions): string {
    options = getPrintOptions(options);
    const w = options.writer!;
    let { name, prelude, rules } = this.value;
    const mark = w.mark();
    // Emit name without trailing whitespace by using its trimmed serializer
    name.toTrimmedString(options);
    const hasPrelude = Boolean(prelude);
    if (hasPrelude) {
      // Ensure exactly one space before the prelude and trim only join-boundary whitespace
      const preludeOut = w.capture(() => prelude!.toTrimmedString(options));
      const normalized = preludeOut.replace(/^\s+/, '').replace(/\s+$/, '');
      w.add(' ');
      w.add(normalized);
    }
    if (rules) {
      // Ensure exactly one space between the last token (name or prelude) and '{'
      w.add(' ');
      const depth = options.depth ?? 0;
      rules.toBraced(depth, options);
    } else {
      w.add(';');
    }
    return w.getSince(mark);
  }

  override async evalNode(context: Context) {
    let node = await super.evalNode(context) as AtRule;
    let rules = node.value.rules;
    /** Don't let rooted rules bubble past an at-rule */
    if (rules) {
      /**
       * Wrap sub-rules of a media query like Less
       *
       * @todo - Make sure this works with and without collapsing
       */
      if (context.opts.collapseNesting && context.rulesetFrames.length) {
        let rule = await new Ruleset({
          selector: new ComplexSelector([new Ampersand()]),
          rules
        })
          .inherit(this)
          .eval(context);
        node.value.rules = new Rules([rule]);
      }
      /** @todo - Figure out at-rule bubbling */
      // let rootRules = this.collectRoots();
      // rootRules.forEach(rule => rules.value.push(rule));
    }
    return node;
  }

  /** @todo - move to visitors */
  // toCSS(context: Context, out: OutputCollector) {
  //   out.add(`${this.name}`, this.location)
  //   /** Prelude expression includes white space */
  //   const value = this.value
  //   if (value) {
  //     value.toCSS(context, out)
  //   }
  //   if (this.rules) {
  //     this.rules.toCSS(context, out)
  //   } else {
  //     out.add(';')
  //   }
  // }

  // toModule(context: Context, out: OutputCollector) {
  //   out.add('$J.atrule({\n', this.location)
  //   const pre = context.pre
  //   context.indent++
  //   out.add(`${pre}  name: ${JSON.stringify(this.name)}`)
  //   const value = this.value
  //   if (value) {
  //     out.add(`,\n${pre}  value: `)
  //     value.toModule(context, out)
  //   }
  //   const rules = this.rules
  //   if (rules) {
  //     out.add(`,\n${pre}  rules: `)
  //     rules.toModule(context, out)
  //   }
  //   context.indent--
  //   out.add(`\n${pre}},${JSON.stringify(this.location)})`)
  // }
}

export const atrule = defineType(AtRule, 'AtRule');