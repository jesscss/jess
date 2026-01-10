import { Node, defineType, F_STATIC, F_VISIBLE, type NodeOptions } from './node';
import { Ruleset } from './ruleset';
import type { Any } from './any';
import { Rules } from './rules';
import type { Context } from '../context';
import { type FinalPrintOptions, type PrintOptions, getPrintOptions } from './util/print';
import { isThenable, type MaybePromise, pipe } from '@jesscss/awaitable-pipe';
import { Ampersand } from './ampersand';
import { isNode } from './util/is-node';
import { indent, normalizeIndent, serializeRulesContainer } from './util/serialize-helper';
import { Interpolated } from './interpolated';
import { Nil } from './nil';

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

  frames: (Ruleset | AtRule)[] | undefined;

  protected _valueOf: string | undefined;

  /** Used for equality comparison with other at-rules */
  override valueOf() {
    return (this._valueOf ??= (this.value.name.toString() + (this.value.prelude ? ' ' + this.value.prelude.valueOf() : '')));
  }

  /**
   * Means: can bubble ruleset parents to children.
   */
  isNestable() {
    return NESTABLE_AT_RULES.includes(this.value.name.valueOf() as (typeof NESTABLE_AT_RULES)[number]);
  }

  /**
   * For legacy collapseNesting, will push ruleset to root silently.
   */
  isRootOnly() {
    return ROOT_ONLY_AT_RULES.includes(this.value.name.valueOf() as (typeof ROOT_ONLY_AT_RULES)[number]);
  }

  isHoisted(opts: { collapseNesting?: boolean }) {
    return this.hoistToRoot ?? opts.collapseNesting ?? false;
  }

  override toTrimmedString(options?: PrintOptions): string {
    options = getPrintOptions(options);
    return serializeRulesContainer(this, options as FinalPrintOptions);
  }

  /**
   * Pre-evaluate name and prelude (similar to Ruleset.preEval)
   * This allows us to extract layer names before rules are evaluated
   */
  override preEval(context: Context): MaybePromise<AtRule | Nil> {
    if (!this.preEvaluated) {
      const node = this.maybeClone(context);
      node.preEvaluated = true;
      // Index should already be assigned by parent Rules
      node.sourceNode ??= this;

      // Evaluate name if needed (for interpolated names)
      let { name } = node.value;
      if (name && name instanceof Interpolated) {
        const maybeKey = name.eval(context);
        if (isThenable(maybeKey)) {
          return (maybeKey as Promise<Any<'atkeyword'>>).then((key) => {
            node.value.name = key;
            return this._preEvalPrelude(node, context);
          });
        }
        node.value.name = maybeKey as Any<'atkeyword'>;
      }

      return this._preEvalPrelude(node, context);
    }
    return this;
  }

  private _preEvalPrelude(node: AtRule, context: Context): MaybePromise<AtRule | Nil> {
    const { prelude } = node.value;
    if (prelude) {
      const out = prelude.eval(context);
      if (isThenable(out)) {
        return (out as Promise<Node>).then((n) => {
          node.value.prelude = n;
          // @import must be at the top of CSS output
          if (node.value.name.value === '@import') {
            (context.topImports ??= []).push(node);
            return new Nil();
          }
          return node;
        });
      }
      node.value.prelude = out;
    }
    // @import must be at the top of CSS output
    if (node.value.name.value === '@import') {
      (context.topImports ??= []).push(node);
      return new Nil();
    }
    return node;
  }

  private _extractAndStoreLayerName(node: AtRule, context: Context): void {
    const atRuleName = node.value.name?.toTrimmedString?.() ?? node.value.name?.toString?.() ?? '';
    if (atRuleName === '@layer' && node.value.prelude) {
      const preludeStr = String(node.value.prelude.valueOf?.() ?? node.value.prelude.toTrimmedString?.() ?? node.value.prelude.toString?.() ?? '');
      if (preludeStr) {
        let parentLayerName: string | undefined;
        for (let i = context.frames.length - 2; i >= 0; i--) {
          const frame = context.frames[i]!;
          if (isNode(frame, 'AtRule') && frame.value.name?.toTrimmedString?.() === '@layer' && frame.value.rules?.value?.includes(node)) {
            parentLayerName = context.extendRoots.getLayerName(frame);
            if (parentLayerName) {
              break;
            }
          }
        }
        const layerName = parentLayerName ? `${parentLayerName}.${preludeStr}` : preludeStr;
        context.extendRoots.setLayerName(node, layerName);
      }
    }
  }

  /** Render the opening of this at-rule (name and prelude) */
  getHeaderString(options: FinalPrintOptions, withoutComments?: boolean): string {
    const w = options.writer;
    let { name, prelude, rules } = this.value;

    let idt = indent(options.depth);
    let out = idt;

    if (withoutComments) {
      name = name.copy(true) as Any<'atkeyword'>;
      if (prelude) {
        prelude = prelude.copy(true) as Node;
      }
    }

    const nameOut = w.capture(() => name.toString(options));
    const nameEndsWithSpace = /\s$/.test(nameOut);
    if (prelude) {
      const preludeOut = w.capture(() => prelude.toString(options));
      const preludeStartsWithSpace = /^\s/.test(preludeOut);

      out += nameOut;
      // If name ends with space AND prelude starts with space, trim the prelude's leading space
      // Otherwise, add a space only if neither has spacing
      let finalPreludeOut = preludeOut;
      if (nameEndsWithSpace && preludeStartsWithSpace) {
        finalPreludeOut = preludeOut.replace(/^\s+/, '');
      } else if (!nameEndsWithSpace && !preludeStartsWithSpace) {
        out += ' ';
      }
      out += finalPreludeOut;
      if (rules) {
        const preludeEndsWithSpace = /\s$/.test(preludeOut);
        if (!preludeEndsWithSpace) {
          out += ' ';
        }
        out = normalizeIndent(out + '{', idt) + '\n';
      } else {
        out = normalizeIndent(out + ';', idt);
      }
    } else {
      out += nameOut;
      if (rules) {
        if (!nameEndsWithSpace) {
          out += ' ';
        }
        out = normalizeIndent(out + '{', idt) + '\n';
      } else {
        out = normalizeIndent(out + ';', idt);
      }
    }
    return out;
  }

  override evalNode(context: Context): MaybePromise<AtRule | Nil> {
    let node = this as AtRule;

    // Check if this is a root-only at-rule that should bubble to root
    // when nested inside a Ruleset. Use hoistToRoot for in-place rendering.
    let shouldClearRulesetFrames = false;
    if (context.bubbleRootAtRules && node.isRootOnly()) {
      const hasRulesetParent = context.frames.some(f => isNode(f, 'Ruleset'));
      if (hasRulesetParent) {
        // Mark for hoisting - this will render at root level but in-place
        node.hoistToRoot = true;
        // We'll clear rulesetFrames when evaluating internal rules
        // to prevent selector inheritance from piercing through
        shouldClearRulesetFrames = true;
      }
    }

    // Store frames snapshot for hoisting serialization
    if (context.opts.collapseNesting || node.hoistToRoot) {
      node.frames = [...context.frames];
    }

    return pipe(
      () => {
        // Prelude is already evaluated in preEval, so we can skip evaluation here
        // Just ensure it's marked as evaluated if it was static
        let { prelude } = node.value;
        if (prelude && prelude.hasFlag(F_STATIC) && !prelude.evaluated) {
          prelude.evaluated = true;
        }
      },
      () => {
        let { rules } = node.value;
        if (rules) {
          if (context.opts.collapseNesting) {
            node.hoistToRoot = true;
          }
          // Push to frames before evaluating rules so we can use context.frames to find parent layers
          // This allows nested layers to find their parent layer names
          // NOTE: We do NOT pop here - the frame must remain accessible during rules evaluation
          // The frame will be popped at the end of evalNode
          context.frames.push(node);

          // Extract and store layer name AFTER pushing to frames but BEFORE evaluating rules
          // This ensures parent layers are already on the stack when we look for them
          this._extractAndStoreLayerName(node, context);

          if (node.isNestable() && node.isHoisted(context.opts)) {
            let existingRules = rules;
            rules = Rules.create([
              Ruleset.create({
                selector: Ampersand.create(undefined),
                rules: existingRules
              })
            ]).inherit(existingRules);
            node.adopt(rules);
          }

          // Register extend root for nestable at-rules (including @layer)
          // We need to register AFTER evaluation because the Rules instance may be replaced
          // Layer name was already extracted in preEval and stored in extend roots registry
          let pushedExtendRoot = false;
          let parentExtendRoot: Rules | undefined;
          if (node.isNestable()) {
            parentExtendRoot = context.extendRoots.getCurrentExtendRoot();
            // Push a placeholder to maintain stack depth - we'll register the actual Rules after evaluation
            context.extendRoots.pushExtendRoot(rules);
            pushedExtendRoot = true;
          }

          let onlyRuleSetChild = isNode(rules.value[0], 'Ruleset');

          // For root-only at-rules that are hoisted, clear rulesetFrames
          // so internal rulesets don't inherit parent selectors
          const savedRulesetFrames = shouldClearRulesetFrames ? context.rulesetFrames : undefined;
          if (shouldClearRulesetFrames) {
            context.rulesetFrames = [];
          }

          let out = rules.eval(context);
          if (isThenable(out)) {
            return (out as Promise<Rules>).then((r) => {
              // Restore rulesetFrames
              if (savedRulesetFrames !== undefined) {
                context.rulesetFrames = savedRulesetFrames;
              }
              // If the only rule was a ruleset, and it evaluated to Rules,
              // discard the extra rules wrapper
              const finalRules = onlyRuleSetChild && isNode(r.value[0], 'Rules') ? r.value[0] : r;
              node.value.rules = finalRules;

              // Register extend root AFTER evaluation using the final Rules instance
              if (pushedExtendRoot && node.isNestable()) {
                context.extendRoots.popExtendRoot(); // Pop the placeholder
                // Retrieve layer name that was stored in evalNode (and delete it)
                const layerName = context.extendRoots.takeLayerName(node);
                context.extendRoots.registerRoot(finalRules, parentExtendRoot, { layerName });
                context.extendRoots.pushExtendRoot(finalRules);
              }

              return node;
            });
          }
          // Restore rulesetFrames (sync path)
          if (savedRulesetFrames !== undefined) {
            context.rulesetFrames = savedRulesetFrames;
          }

          const finalRules = onlyRuleSetChild && isNode(out.value[0], 'Rules') ? out.value[0] : out;
          node.value.rules = finalRules;

          // Register extend root AFTER evaluation using the final Rules instance
          if (pushedExtendRoot && node.isNestable()) {
            context.extendRoots.popExtendRoot(); // Pop the placeholder
            // Retrieve layer name that was stored in evalNode (and delete it)
            const layerName = context.extendRoots.takeLayerName(node);
            context.extendRoots.registerRoot(finalRules, parentExtendRoot, { layerName });
            context.extendRoots.pushExtendRoot(finalRules);
          }
        }
        return node;
      },
      () => {
        // Pop the frame that was pushed in preEval
        // This frame was kept on the stack during rules evaluation so children could access it
        context.frames.pop();
        let rules = node.value.rules;
        if (rules && rules.visibleRules().length === 0) {
          this.removeFlag(F_VISIBLE);
        }
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