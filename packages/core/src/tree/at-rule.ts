import { Node, defineType, F_STATIC, type NodeOptions, type LocationInfo } from './node';
import { Ruleset } from './ruleset';
import type { Any } from './any';
import { Rules } from './rules';
import type { Context, TreeContext } from '../context';
import { type FinalPrintOptions, type PrintOptions, getPrintOptions } from './util/print';
import { isThenable, type MaybePromise, pipe } from '@jesscss/awaitable-pipe';
import { Ampersand } from './ampersand';
import { isNode } from './util/is-node';
import { serializeRulesContainer } from './util/serialize-helper';

export type AtRuleValue = {
  name: Any<'atkeyword'>;
  /** The prelude */
  prelude?: Node;
  rules?: Rules;
};

export const NESTABLE_AT_RULES = ['@media', '@supports', '@layer', '@container', '@scope'] as const;
export const ROOT_ONLY_AT_RULES = [
  '@charset',
  '@import',
  '@namespace',
  '@font-face',
  '@keyframes',
  '@page',
  '@property',
  '@counter-style',
  '@viewport'
] as const;

export type AtRuleOptions = NodeOptions;

/**
 * A rule like @charset or @media
 */
export class AtRule extends Node<AtRuleValue, AtRuleOptions> {
  type = 'AtRule' as const;
  shortType = 'atrule' as const;
  override allowRoot = true;

  constructor(value: AtRuleValue, options?: AtRuleOptions, location?: LocationInfo, treeContext?: TreeContext) {
    super(value, options, location, treeContext);
    /** Normally set by parser, but convenience for API */
    if (
      options?.nestable === undefined
    ) {
      let name = value.name.value;
      if (['@media', '@supports', '@layer', '@container', '@scope'].includes(name)) {
        this.options.nestable = true;
      }
    }
  }

  frames: (Ruleset | AtRule)[] | undefined;

  /**
   * Means: can bubble ruleset parents to children.
   */
  isNestable() {
    return NESTABLE_AT_RULES.includes(this.value.name.toString() as (typeof NESTABLE_AT_RULES)[number]);
  }

  /**
   * For legacy collapseNesting, will push ruleset to root silently.
   */
  isRootOnly() {
    return ROOT_ONLY_AT_RULES.includes(this.value.name.toString() as (typeof ROOT_ONLY_AT_RULES)[number]);
  }

  isHoisted(opts: { collapseNesting?: boolean }) {
    return this.options.hoistToRoot ?? opts.collapseNesting ?? false;
  }

  override toTrimmedString(options?: PrintOptions): string {
    options = getPrintOptions(options);
    return serializeRulesContainer(this, options as FinalPrintOptions);
  }

  /** Render the opening of this at-rule (name and prelude) */
  getHeaderString(options: FinalPrintOptions): string {
    const w = options.writer;
    const { name, prelude, rules } = this.value;

    let out = options.indent;

    out += w.capture(() => name.toString(options));
    const nameEndsWithSpace = /\s$/.test(out);
    if (prelude) {
      const preludeOut = w.capture(() => prelude.toString(options));
      // See if prelude startsWith whitespace (any whitespace character)
      const preludeStartsWithSpace = /^\s/.test(preludeOut);

      if (!nameEndsWithSpace && !preludeStartsWithSpace) {
        out += ' ';
      }
      out += preludeOut;
      if (rules) {
        const preludeEndsWithSpace = /\s$/.test(preludeOut);
        if (!preludeEndsWithSpace) {
          out += ' {';
        }
      } else {
        out += ';';
      }
    } else {
      if (rules) {
        if (!nameEndsWithSpace) {
          out += ' ';
        }
        out += '{';
      } else {
        out += ';';
      }
    }
    return out;
  }

  override evalNode(context: Context): MaybePromise<AtRule> {
    let node = this as AtRule;

    // Store frames snapshot for collapseNesting serialization
    if (context.opts.collapseNesting || node.options.hoistToRoot) {
      node.frames = [...context.frames];
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
          node.options.hoistToRoot ||= context.opts.collapseNesting;
          context.frames.push(node);
          if (node.isNestable() && node.isHoisted(context.opts)) {
            let existingRules = rules;
            rules = Rules.create([
              Ruleset.create({
                selector: Ampersand.create(undefined),
                rules: existingRules
              })
            ]).inherit(existingRules);
            rules.parent = node;
          }

          // Register extend root for nestable at-rules (including @layer)
          let pushedExtendRoot = false;
          if (node.options.nestable) {
            const parentExtendRoot = context.extendRoots.getCurrentExtendRoot();
            // Extract layer name for @layer at-rules
            let layerName: string | undefined;
            const atRuleName = node.value.name?.toTrimmedString?.() ?? node.value.name?.toString?.() ?? '';
            if (atRuleName === '@layer' && node.value.prelude) {
              const preludeStr = node.value.prelude.toTrimmedString?.() ?? node.value.prelude.toString?.() ?? '';
              if (preludeStr) {
                // Check if parent has a layer name and concatenate
                const parentLayerName = parentExtendRoot ? context.extendRoots.getLayerName(parentExtendRoot) : undefined;
                layerName = parentLayerName ? `${parentLayerName}.${preludeStr}` : preludeStr;
              }
            }
            context.extendRoots.registerRoot(rules, parentExtendRoot, { layerName });
            context.extendRoots.pushExtendRoot(rules);
            pushedExtendRoot = true;
          }

          let onlyRuleSetChild = isNode(rules.value[0], 'Ruleset');

          let out = rules.eval(context);
          if (isThenable(out)) {
            return (out as Promise<Rules>).then((r) => {
              // If the only rule was a ruleset, and it evaluated to Rules,
              // discard the extra rules wrapper
              if (onlyRuleSetChild && isNode(r.value[0], 'Rules')) {
                node.value.rules = r.value[0];
              } else {
                node.value.rules = r;
              }
              if (pushedExtendRoot) {
                context.extendRoots.popExtendRoot();
              }
              return node;
            });
          }
          if (onlyRuleSetChild && isNode(out.value[0], 'Rules')) {
            node.value.rules = out.value[0];
          } else {
            node.value.rules = out;
          }
          if (pushedExtendRoot) {
            context.extendRoots.popExtendRoot();
          }
        }
        return node;
      },
      () => {
        context.frames.pop();
        return node;
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