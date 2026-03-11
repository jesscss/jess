import { Node, defineType, F_VISIBLE, type NodeOptions } from './node.js';
import { Ruleset } from './ruleset.js';
import { Any } from './any.js';
import { Rules } from './rules.js';
import type { Context } from '../context.js';
import { type FinalPrintOptions, type PrintOptions, getPrintOptions } from './util/print.js';
import { isThenable, type MaybePromise, pipe } from '@jesscss/awaitable-pipe';
import { Ampersand } from './ampersand.js';
import { isNode } from './util/is-node.js';
import { N } from './node-type.js';
import { indent, normalizeIndent, serializeRulesContainer } from './util/serialize-helper.js';
import { Interpolated } from './interpolated.js';
import { Nil } from './nil.js';

/**
 * When collapseNesting/hoist wrapped at-rule rules in a single Ruleset(&),
 * the real rulesets (.ma, .md, etc.) registered to the inner Rules (the wrapper
 * Ruleset's rules). Register that inner Rules as a child extend root so
 * processExtends can find them. Extend behavior must not depend on collapseNesting.
 */
function registerInnerExtendRootIfHoisted(
  wrapperRules: Rules,
  context: Context,
  layerName?: string
): void {
  if (wrapperRules.data.length !== 1) {
    return;
  }
  const first = wrapperRules.data[0];
  if (!isNode(first, N.Ruleset)) {
    return;
  }
  const innerRules = first.data.rules;
  if (!innerRules || !isNode(innerRules, N.Rules)) {
    return;
  }
  context.extendRoots.registerRoot(innerRules, wrapperRules, { layerName });
}

export type AtRuleValue = {
  name: Any<'atkeyword'> | Interpolated<'atkeyword'>;
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
export interface AtRule {
  type: 'AtRule';
  shortType: 'atrule';
}

export class AtRule extends Node<AtRuleValue, AtRuleOptions> {
  override allowRoot = true;

  frames: (Ruleset | AtRule)[] | undefined;

  get name() {
    return this.data.name;
  }

  set name(val: AtRuleValue['name']) {
    this.setData('name', val);
  }

  get prelude() {
    return this.data.prelude;
  }

  set prelude(val: AtRuleValue['prelude']) {
    this.setData('prelude', val as any);
  }

  get rules() {
    return this.data.rules;
  }

  set rules(val: AtRuleValue['rules']) {
    this.setData('rules', val as any);
  }

  protected _valueOf: string | undefined;

  /** Used for equality comparison with other at-rules */
  override valueOf() {
    return (this._valueOf ??= (this.data.name.toString() + (this.data.prelude ? ' ' + this.data.prelude.valueOf() : '')));
  }

  /**
   * Means: can bubble ruleset parents to children.
   */
  isNestable() {
    return NESTABLE_AT_RULES.includes(this.data.name.valueOf() as (typeof NESTABLE_AT_RULES)[number]);
  }

  /**
   * For legacy collapseNesting, will push ruleset to root silently.
   */
  isRootOnly() {
    return ROOT_ONLY_AT_RULES.includes(this.data.name.valueOf() as (typeof ROOT_ONLY_AT_RULES)[number]);
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
      let { name } = node.data;
      if (name && name instanceof Interpolated) {
        const maybeKey = name.eval(context);
        if (isThenable(maybeKey)) {
          return (maybeKey as Promise<Any<'atkeyword'>>).then((key) => {
            node.setData('name', key);
            return this._preEvalPrelude(node, context);
          });
        }
        node.setData('name', maybeKey as Any<'atkeyword'>);
      }

      return this._preEvalPrelude(node, context);
    }
    return this;
  }

  private _preEvalPrelude(node: AtRule, context: Context): MaybePromise<AtRule | Nil> {
    const { prelude, rules } = node.data;
    // Preserve @import prelude as-authored (including comments). Evaluation here can
    // normalize/strip comment tokens inside the prelude, but less.js expects them preserved.
    const atRuleName = String(node.data.name.valueOf?.() ?? node.data.name ?? '').trim();
    if (atRuleName === '@import') {
      if (prelude) {
        node.setData('prelude', prelude);
      }
      // Reference branches are traversed for symbol/extend resolution, but plain
      // CSS @import hoisting must remain a visible-output concern only.
      if (!context.inReferenceImportScope) {
        const topImports = (context.topImports ??= []);
        const nodeLoc = node.location?.join(':') ?? '';
        const nodeSig = `${node.data.name.valueOf?.() ?? node.data.name}:${node.data.prelude?.valueOf?.() ?? ''}`;
        const alreadyQueued = topImports.some((queuedNode) => {
          if (!isNode(queuedNode, N.AtRule)) {
            return false;
          }
          const queued = queuedNode as AtRule;
          return (
            queued === node
            || queued.sourceNode === node.sourceNode
            || queued.sourceNode === node
            || (
              (queued.location?.join(':') ?? '') === nodeLoc
              && `${queued.data.name.valueOf?.() ?? queued.data.name}:${queued.data.prelude?.valueOf?.() ?? ''}` === nodeSig
            )
          );
        });
        if (!alreadyQueued) {
          topImports.push(node);
        }
      }
      return new Nil();
    }
    // Defer prelude evaluation to evalNode so variable lookups happen in the correct
    // call-time scope (e.g. mixin parameters referenced from nested @media preludes).
    if (prelude) {
      node.setData('prelude', prelude);
    }
    // Depth-first: preEval child rules immediately so all nested rulesets/extends
    // are registered in source order before we process extends.
    if (rules && !rules.preEvaluated) {
      // For nestable at-rules we do NOT push the original here. The body's Rules.preEval
      // pushes the clone (the Rules that ends up in the tree) so rulesets register to it.
      // Pushing the original would leave the clone's registry empty (extend + collapseNesting bug).
      let pushedExtendRootForPreEval = false;
      if (!node.isNestable()) {
        context.extendRoots.pushExtendRoot(rules);
        pushedExtendRootForPreEval = true;
      }
      // Root-only at-rules (@keyframes, @font-face, etc.): do not let parent ruleset frames
      // pierce into the body — clear rulesetFrames so 0%/100% etc. are not combined with .parent.
      const savedRulesetFramesForPreEval = node.isRootOnly() ? context.rulesetFrames : undefined;
      if (node.isRootOnly()) {
        context.rulesetFrames = [];
      }
      const preEvaldRules = rules.preEval(context);
      if (isThenable(preEvaldRules)) {
        return (preEvaldRules as Promise<Rules>).then((evaldRules) => {
          if (savedRulesetFramesForPreEval !== undefined) {
            context.rulesetFrames = savedRulesetFramesForPreEval;
          }
          if (pushedExtendRootForPreEval) {
            context.extendRoots.popExtendRoot();
          }
          node.setData('rules', evaldRules);
          return node;
        });
      }
      if (savedRulesetFramesForPreEval !== undefined) {
        context.rulesetFrames = savedRulesetFramesForPreEval;
      }
      if (pushedExtendRootForPreEval) {
        context.extendRoots.popExtendRoot();
      }
      node.setData('rules', preEvaldRules as Rules);
    }
    return node;
  }

  private _extractAndStoreLayerName(node: AtRule, context: Context): void {
    const atRuleName = node.data.name?.toTrimmedString?.() ?? node.data.name?.toString?.() ?? '';
    if (atRuleName === '@layer' && node.data.prelude) {
      const preludeStr = String(node.data.prelude.valueOf?.() ?? node.data.prelude.toTrimmedString?.() ?? node.data.prelude.toString?.() ?? '');
      if (preludeStr) {
        let parentLayerName: string | undefined;
        for (let i = context.frames.length - 2; i >= 0; i--) {
          const frame = context.frames[i]!;
          if (isNode(frame, N.AtRule) && frame.data.name?.toTrimmedString?.() === '@layer' && frame.data.rules?.data?.includes(node)) {
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
    let { name, prelude, rules } = this.data;

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

    // @plugin is handled by the Less compatibility plugin (preEval). If we reach eval and it's still visible, no plugin processed it.
    const atName = String(node.data?.name?.valueOf?.() ?? '');
    if (atName === '@plugin' && node.visible) {
      throw new Error('@plugin is only supported when using the Less compatibility plugin (@jesscss/plugin-less-compat).');
    }

    // Check if this is a root-only at-rule that should bubble to root
    // when nested inside a Ruleset. Use hoistToRoot for in-place rendering.
    let shouldClearRulesetFrames = false;
    if (context.bubbleRootAtRules && node.isRootOnly()) {
      const hasRulesetParent = context.frames.some(f => isNode(f, N.Ruleset));
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

    const tryMergeNestedMedia = () => {
      // Nested @media merge is currently disabled to match less.js fixture expectations.
      // (Some fixtures expect nested @media blocks to remain nested rather than being
      // rewritten as `@media a and b`.)
      if (process.env.ENABLE_NESTED_MEDIA_MERGE !== 'true') {
        return;
      }
      if (node.data.name?.valueOf?.() !== '@media') {
        return;
      }
      const outerRules = node.data.rules;
      if (!outerRules) {
        return;
      }
      const visible = outerRules.data.filter(n => n.visible);
      if (visible.length !== 1) {
        return;
      }
      const only = visible[0]!;
      if (!isNode(only, N.AtRule) || (only as AtRule).data.name?.valueOf?.() !== '@media') {
        return;
      }
      const inner = only as AtRule;
      const innerRules = inner.data.rules;
      if (!innerRules) {
        return;
      }

      // Combine media queries using "and" like Less does.
      const outerPrelude = node.data.prelude;
      const innerPrelude = inner.data.prelude;
      if (outerPrelude && innerPrelude) {
        // Build a normalized text prelude to avoid double-spacing from nested sequences.
        const outerText = outerPrelude.toTrimmedString().trim();
        const innerText = innerPrelude.toTrimmedString().trim();
        const combined = `${outerText} and ${innerText}`.replace(/[ \t]+/g, ' ').trim();
        node.setData('prelude', new Any(combined));
      } else {
        node.setData('prelude', outerPrelude ?? innerPrelude);
      }

      // Replace outer rules with the inner rules (flatten nested media).
      node.setData('rules', innerRules);
      node.adopt(innerRules);
    };

    return pipe(
      () => {
        // Evaluate prelude in the correct scope (mixin params, vars, etc.).
        let { prelude } = node.data;
        if (prelude) {
          // Evaluate the prelude in the outer (enclosing) Rules scope, not the nested @media Rules scope.
          // This matches Less behavior for mixin parameters referenced from nested @media preludes.
          const savedRulesContext = context.rulesContext;
          let liftedRulesContext = savedRulesContext;
          // If our current rulesContext is a Rules whose parent is an AtRule, lift to the enclosing Rules.
          if (liftedRulesContext && isNode(liftedRulesContext, N.Rules)) {
            let cursor: any = liftedRulesContext;
            let depth = 0;
            while (cursor?.parent && depth++ < 10) {
              if (isNode(cursor.parent, N.AtRule) && isNode(cursor.parent.parent, N.Rules)) {
                cursor = cursor.parent.parent;
                continue;
              }
              break;
            }
            liftedRulesContext = cursor;
          }
          context.rulesContext = liftedRulesContext;
          const out = prelude.eval(context);
          context.rulesContext = savedRulesContext;
          if (isThenable(out)) {
            return (out as Promise<Node>).then((n) => {
              node.setData('prelude', n);
              return undefined;
            });
          }
          node.setData('prelude', out as Node);
        }
      },
      () => {
        let { rules } = node.data;
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

          // Wrap in Ruleset(&) when hoisted for nestable at-rules only. Do NOT wrap @keyframes,
          // @font-face, or other at-rules in ROOT_ONLY_AT_RULES — their children must not get
          // a wrapper so keyframe percentages (0%, 100%) etc. are not combined with parent selectors.
          // Required for serialization: rulesets inside @media need this wrapper to output
          // e.g. ".parent { font-size: 14px; }" inside @media.
          if (node.isNestable() && !node.isRootOnly() && node.isHoisted(context.opts)) {
            let existingRules = rules;
            rules = Rules.create([
              Ruleset.create({
                selector: Ampersand.create(undefined),
                rules: existingRules
              }, { generated: true })
            ]).inherit(existingRules);
            node.adopt(rules);
          }

          // Register extend root for nestable at-rules (including @layer).
          // Run preEval first so we push and later register the Rules that is actually evaluated
          // (clone or original). Otherwise we push the original but eval runs on a clone, so the
          // registered root has no rulesets and extend-chaining / nested at-rule extends fail.
          let pushedExtendRoot = false;
          let parentExtendRoot: Rules | undefined;
          let bodyToEval: Rules = rules;
          if (node.isNestable()) {
            parentExtendRoot = context.extendRoots.getCurrentExtendRoot();
            const preEvalResult = rules.preEval(context);
            if (isThenable(preEvalResult)) {
              return (preEvalResult as Promise<Rules>).then((resolved) => {
                bodyToEval = resolved;
                context.extendRoots.pushExtendRoot(bodyToEval);
                pushedExtendRoot = true;
                const savedRulesetFrames = shouldClearRulesetFrames ? context.rulesetFrames : undefined;
                if (shouldClearRulesetFrames) {
                  context.rulesetFrames = [];
                }
                const onlyRuleSetChild = isNode(bodyToEval.data[0], N.Ruleset);
                const evalOut = bodyToEval.eval(context);
                const doRegister = (r: Rules) => {
                  if (savedRulesetFrames !== undefined) {
                    context.rulesetFrames = savedRulesetFrames;
                  }
                  const finalRules =
                    onlyRuleSetChild && isNode(r.data[0], N.Rules) ? r.data[0] : r;
                  node.setData('rules', finalRules);
                  tryMergeNestedMedia();
                  context.extendRoots.popExtendRoot();
                  const layerName = context.extendRoots.takeLayerName(node);
                  const parent = parentExtendRoot ?? context.root ?? undefined;
                  context.extendRoots.registerRoot(bodyToEval, parent as Rules | undefined, {
                    layerName
                  });
                  registerInnerExtendRootIfHoisted(bodyToEval, context, layerName);
                  if (finalRules !== bodyToEval) {
                    context.extendRoots.registerRoot(finalRules as Rules, bodyToEval, { layerName });
                    registerInnerExtendRootIfHoisted(finalRules, context, layerName);
                  }
                  context.extendRoots.pushExtendRoot(bodyToEval);
                  context.extendRoots.popExtendRoot();
                  return node;
                };
                if (isThenable(evalOut)) {
                  return (evalOut as Promise<Rules>).then(doRegister);
                }
                return doRegister(evalOut as Rules);
              });
            }
            bodyToEval = preEvalResult as Rules;
            context.extendRoots.pushExtendRoot(bodyToEval);
            pushedExtendRoot = true;
          }

          let onlyRuleSetChild = isNode(bodyToEval.data[0], N.Ruleset);

          // For root-only at-rules that are hoisted, clear rulesetFrames
          // so internal rulesets don't inherit parent selectors
          const savedRulesetFrames = shouldClearRulesetFrames ? context.rulesetFrames : undefined;
          if (shouldClearRulesetFrames) {
            context.rulesetFrames = [];
          }

          let out = bodyToEval.eval(context);
          if (isThenable(out)) {
            return (out as Promise<Rules>).then((r) => {
              // Restore rulesetFrames
              if (savedRulesetFrames !== undefined) {
                context.rulesetFrames = savedRulesetFrames;
              }
              // If the only rule was a ruleset, and it evaluated to Rules,
              // discard the extra rules wrapper
              const finalRules = onlyRuleSetChild && isNode(r.data[0], N.Rules) ? r.data[0] : r;
              node.setData('rules', finalRules);
              tryMergeNestedMedia();

              if (pushedExtendRoot && node.isNestable()) {
                context.extendRoots.popExtendRoot();
                const layerName = context.extendRoots.takeLayerName(node);
                const parent = parentExtendRoot ?? context.root ?? undefined;
                context.extendRoots.registerRoot(bodyToEval, parent as Rules | undefined, {
                  layerName
                });
                registerInnerExtendRootIfHoisted(bodyToEval, context, layerName);
                if (finalRules !== bodyToEval) {
                  context.extendRoots.registerRoot(finalRules as Rules, bodyToEval, { layerName });
                  registerInnerExtendRootIfHoisted(finalRules, context, layerName);
                }
                context.extendRoots.pushExtendRoot(bodyToEval);
                context.extendRoots.popExtendRoot();
              }

              return node;
            });
          }
          // Restore rulesetFrames (sync path)
          if (savedRulesetFrames !== undefined) {
            context.rulesetFrames = savedRulesetFrames;
          }

          const finalRules =
            onlyRuleSetChild && isNode(out.data[0], N.Rules) ? out.data[0] : out;
          node.setData('rules', finalRules);
          tryMergeNestedMedia();

          if (pushedExtendRoot && node.isNestable()) {
            context.extendRoots.popExtendRoot();
            const layerName = context.extendRoots.takeLayerName(node);
            const parent = parentExtendRoot ?? context.root ?? undefined;
            context.extendRoots.registerRoot(bodyToEval, parent as Rules | undefined, { layerName });
            registerInnerExtendRootIfHoisted(bodyToEval, context, layerName);
            if (finalRules !== bodyToEval) {
              context.extendRoots.registerRoot(finalRules as Rules, bodyToEval, { layerName });
              registerInnerExtendRootIfHoisted(finalRules, context, layerName);
            }
            context.extendRoots.pushExtendRoot(bodyToEval);
            context.extendRoots.popExtendRoot();
          }
        }
        return node;
      },
      () => {
        // Pop the frame that was pushed in preEval
        // This frame was kept on the stack during rules evaluation so children could access it
        context.frames.pop();
        let rules = node.data.rules;
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
  //   const value = this.data
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
  //   const value = this.data
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