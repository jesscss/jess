import { Node, defineType, F_STATIC } from './node';
import { ComplexSelector } from './selector-complex';
import { Ampersand } from './ampersand';
import { amp } from './ampersand';
import { Ruleset } from './ruleset';
import type { Any } from './any';
import { Rules } from './rules';
import type { Context } from '../context';
import { type PrintOptions, getPrintOptions } from './util/print';
import { isThenable, type MaybePromise, pipe } from '@jesscss/awaitable-pipe';

export type AtRuleValue = {
  name: Any<'atkeyword'>;
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

    // Emit name
    name.toString(options);

    if (prelude) {
      // Ensure there's a space between name and prelude
      w.add(' ');
      prelude.toString(options);
    }

    if (rules) {
      // Ensure there's a space before the rules
      w.add(' ');
      const depth = options.depth ?? 0;
      // For rules, we can call toBraced directly since it writes to the writer
      rules.toBraced(depth, options);
    } else {
      w.add(';');
    }

    return w.getSince(mark);
  }

  override evalNode(context: Context): MaybePromise<AtRule> {
    let node = this as AtRule;

    // Store frames snapshot for collapseNesting serialization
    if (context.opts.collapseNesting) {
      (node as any).frames = [...context.frames];
    }

    return pipe(
      () => {
        let { prelude } = node.value;
        if (prelude) {
          if (prelude.hasFlag(F_STATIC)) {
            prelude.evaluated = true;
          } else {
            let out = prelude.eval(context);
            if (isThenable(out)) {
              return (out as Promise<Node>).then((n) => {
                node.value.prelude = n;
                return node;
              });
            }
            node.value.prelude = out;
          }
        }
      },
      () => {
        let { rules } = node.value;
        if (rules) {
          let out = rules.eval(context);
          if (isThenable(out)) {
            return (out as Promise<Rules>).then((r) => {
              node.value.rules = r;
              return node;
            });
          }
          node.value.rules = out;
        }
        return node;
      },
      (evaldNode: Node) => {
        if (evaldNode instanceof AtRule) {
          node = evaldNode;
          let rules = node.value.rules;
          if (rules) {
            if (context.opts.collapseNesting && context.rulesetFrames.length) {
              return new Ruleset({
                selector: amp(),
                rules
              })
                .inherit(this)
                .eval(context);
            }
            return node as Node;
          }
        }
        return evaldNode;
      },
      (unknownNode: Node) => {
        if (unknownNode instanceof Ruleset) {
          node.value.rules = new Rules([unknownNode]);
          return node as Node;
        }
        /** @todo - Figure out at-rule bubbling */
        // let rootRules = this.collectRoots();
        // rootRules.forEach(rule => rules.value.push(rule));
        return unknownNode;
      }
    ) as MaybePromise<AtRule>;
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