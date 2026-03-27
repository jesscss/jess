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
import type { Selector } from './selector.js';
import { getField, getParent, setField, isPreEvaluated } from './util/field-helpers.js';

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
  if (wrapperRules.value.length !== 1) {
    return;
  }
  const first = wrapperRules.value[0];
  if (!isNode(first, N.Ruleset)) {
    return;
  }
  const innerRules = first.rules;
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
  static override childKeys = ['name', 'prelude', 'rules'] as const;

  readonly name!: Any<'atkeyword'> | Interpolated<'atkeyword'>;
  readonly prelude: Node | undefined;
  readonly rules: Rules | undefined;
  readonly frames: (Ruleset | AtRule)[] | undefined;

  constructor(value: AtRuleValue, options?: AtRuleOptions, location?: any, treeContext?: any) {
    super(value, options, location, treeContext);
    this.name = value.name;
    this.prelude = value.prelude;
    this.rules = value.rules;
    if (this.name instanceof Node) {
      this.adopt(this.name);
    }
    if (this.prelude instanceof Node) {
      this.adopt(this.prelude);
    }
    if (this.rules instanceof Node) {
      this.adopt(this.rules);
    }
    this.allowRoot = true;
  }

  protected _valueOf: string | undefined;

  private _getName(context?: Context): Any<'atkeyword'> | Interpolated<'atkeyword'> {
    return context
      ? getField<Any<'atkeyword'> | Interpolated<'atkeyword'>>(this, 'name', context)
      : this.name;
  }

  private _getPrelude(context?: Context): Node | undefined {
    return context
      ? getField<Node | undefined>(this, 'prelude', context)
      : this.prelude;
  }

  private _getRulesContainer(context?: Context): Rules | undefined {
    return context
      ? getField<Rules | undefined>(this, 'rules', context)
      : this.rules;
  }

  /** Used for equality comparison with other at-rules */
  override valueOf() {
    return (this._valueOf ??= (this.name.toString() + (this.prelude ? ' ' + this.prelude.valueOf() : '')));
  }

  /**
   * Means: can bubble ruleset parents to children.
   */
  isNestable(context?: Context) {
    return NESTABLE_AT_RULES.includes(this._getName(context).valueOf() as (typeof NESTABLE_AT_RULES)[number]);
  }

  /**
   * For legacy collapseNesting, will push ruleset to root silently.
   */
  isRootOnly(context?: Context) {
    return ROOT_ONLY_AT_RULES.includes(this._getName(context).valueOf() as (typeof ROOT_ONLY_AT_RULES)[number]);
  }

  isHoisted(opts: { collapseNesting?: boolean; context?: Context }) {
    const hoistToRoot = opts.context
      ? getField<boolean | undefined>(this, 'hoistToRoot', opts.context) ?? this.hoistToRoot
      : this.hoistToRoot;
    return hoistToRoot ?? opts.collapseNesting ?? false;
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
    if (!this._isPreEvaluated(context)) {
      /** @removal-target — node-copy-reduction: maybeClone → return this.
       * preEval writes (hoistToRoot, frames, ownSelector) should go through
       * position.setField. sourceNode assignment becomes unnecessary. */
      const node = this.maybeClone(context);
      node._setPreEvaluated(true, context);
      // Index should already be assigned by parent Rules
      node.sourceNode ??= this;

      // Evaluate name if needed (for interpolated names)
      const name = node._getName(context);
      if (name && name instanceof Interpolated) {
        const maybeKey = name.eval(context);
        if (isThenable(maybeKey)) {
          return (maybeKey as Promise<Any<'atkeyword'>>).then((key) => {
            setField(node, 'name', key, context);
            return this._preEvalPrelude(node, context);
          });
        }
        setField(node, 'name', maybeKey as Any<'atkeyword'>, context);
      }

      return this._preEvalPrelude(node, context);
    }
    return this;
  }

  private _preEvalPrelude(node: AtRule, context: Context): MaybePromise<AtRule | Nil> {
    const prelude = node._getPrelude(context);
    const rules = node._getRulesContainer(context);
    // Preserve @import prelude as-authored (including comments). Evaluation here can
    // normalize/strip comment tokens inside the prelude, but less.js expects them preserved.
    const name = node._getName(context);
    const atRuleName = String(name.valueOf?.() ?? name ?? '').trim();
    if (atRuleName === '@import') {
      if (prelude) {
        setField(node, 'prelude', prelude, context);
      }
      // Reference branches are traversed for symbol/extend resolution, but plain
      // CSS @import hoisting must remain a visible-output concern only.
      if (!context.inReferenceImportScope) {
        const topImports = (context.topImports ??= []);
        const nodeLoc = node.location?.join(':') ?? '';
        const nodeSig = `${name.valueOf?.() ?? name}:${prelude?.valueOf?.() ?? ''}`;
        const alreadyQueued = topImports.some((queuedNode) => {
          if (!isNode(queuedNode, N.AtRule)) {
            return false;
          }
          const queued = queuedNode as AtRule;
          const queuedName = queued._getName(context);
          const queuedPrelude = queued._getPrelude(context);
          return (
            queued === node
            || queued.sourceNode === node.sourceNode
            || queued.sourceNode === node
            || (
              (queued.location?.join(':') ?? '') === nodeLoc
              && `${queuedName.valueOf?.() ?? queuedName}:${queuedPrelude?.valueOf?.() ?? ''}` === nodeSig
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
      setField(node, 'prelude', prelude, context);
    }
    // Depth-first: preEval child rules immediately so all nested rulesets/extends
    // are registered in source order before we process extends.
    if (rules && !isPreEvaluated(rules, context)) {
      // For nestable at-rules we do NOT push the original here. The body's Rules.preEval
      // pushes the clone (the Rules that ends up in the tree) so rulesets register to it.
      // Pushing the original would leave the clone's registry empty (extend + collapseNesting bug).
      let pushedExtendRootForPreEval = false;
      if (!node.isNestable(context)) {
        context.extendRoots.pushExtendRoot(rules);
        pushedExtendRootForPreEval = true;
      }
      // Root-only at-rules (@keyframes, @font-face, etc.): do not let parent ruleset frames
      // pierce into the body — clear rulesetFrames so 0%/100% etc. are not combined with .parent.
      const savedRulesetFramesForPreEval = node.isRootOnly(context) ? context.rulesetFrames : undefined;
      if (node.isRootOnly(context)) {
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
          setField(node, 'rules', evaldRules, context);
          return node;
        });
      }
      if (savedRulesetFramesForPreEval !== undefined) {
        context.rulesetFrames = savedRulesetFramesForPreEval;
      }
      if (pushedExtendRootForPreEval) {
        context.extendRoots.popExtendRoot();
      }
      setField(node, 'rules', preEvaldRules as Rules, context);
    }
    return node;
  }

  private _extractAndStoreLayerName(node: AtRule, context: Context): void {
    const name = node._getName(context);
    const prelude = node._getPrelude(context);
    const atRuleName = name?.toTrimmedString?.() ?? name?.toString?.() ?? '';
    if (atRuleName === '@layer' && prelude) {
      const preludeStr = String(prelude.valueOf?.() ?? prelude.toTrimmedString?.() ?? prelude.toString?.() ?? '');
      if (preludeStr) {
        let parentLayerName: string | undefined;
        for (let i = context.frames.length - 2; i >= 0; i--) {
          const frame = context.frames[i]!;
          if (!isNode(frame, N.AtRule)) {
            continue;
          }
          const parentFrame = frame as AtRule;
          const parentName = parentFrame._getName(context);
          const parentRules = parentFrame._getRulesContainer(context);
          if (parentName?.toTrimmedString?.() === '@layer' && parentRules?.value?.includes(node)) {
            parentLayerName = context.extendRoots.getLayerName(parentFrame);
          }
          if (parentLayerName) {
            break;
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
    const name = this._getName(options.context);
    const prelude = this._getPrelude(options.context);
    const rules = this._getRulesContainer(options.context);

    let idt = indent(options.depth);
    let out = idt;

    if (withoutComments) {
      options = { ...options, suppressComments: true };
    }

    const nameOut = w.capture(() => name.toString(options));
    const nameEndsWithSpace = /\s$/.test(nameOut);
    const preludeOut = prelude ? w.capture(() => prelude.toString(options)) : '';
    const hasPreludeContent = /\S/.test(preludeOut);
    if (prelude && hasPreludeContent) {
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
        const preludeEndsWithSpace = /\s$/.test(finalPreludeOut);
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
    const atName = String(node._getName(context)?.valueOf?.() ?? '');
    if (atName === '@plugin' && node.visible) {
      throw new Error('@plugin is only supported when using the Less compatibility plugin (@jesscss/plugin-less-compat).');
    }

    // Check if this is a root-only at-rule that should bubble to root
    // when nested inside a Ruleset. Use hoistToRoot for in-place rendering.
    let shouldClearRulesetFrames = false;
    if (context.bubbleRootAtRules && node.isRootOnly(context)) {
      const hasRulesetParent = context.frames.some(f => isNode(f, N.Ruleset));
      if (hasRulesetParent) {
        // Mark for hoisting - this will render at root level but in-place
        setField(node, 'hoistToRoot', true, context);
        // We'll clear rulesetFrames when evaluating internal rules
        // to prevent selector inheritance from piercing through
        shouldClearRulesetFrames = true;
      }
    }

    // Store frames snapshot for hoisting serialization
    const nodeHoistToRoot = getField<boolean | undefined>(node, 'hoistToRoot', context) ?? node.hoistToRoot;
    if (context.opts.collapseNesting || nodeHoistToRoot) {
      setField(node, 'frames', [...context.frames], context);
    }

    const tryMergeNestedMedia = () => {
      // Nested @media merge is currently disabled to match less.js fixture expectations.
      // (Some fixtures expect nested @media blocks to remain nested rather than being
      // rewritten as `@media a and b`.)
      if (process.env.ENABLE_NESTED_MEDIA_MERGE !== 'true') {
        return;
      }
      if (node._getName(context)?.valueOf?.() !== '@media') {
        return;
      }
      const outerRules = node._getRulesContainer(context);
      if (!outerRules) {
        return;
      }
      const visible = outerRules.value.filter(n => n.visible);
      if (visible.length !== 1) {
        return;
      }
      const only = visible[0]!;
      if (!isNode(only, N.AtRule) || (only as AtRule)._getName(context)?.valueOf?.() !== '@media') {
        return;
      }
      const inner = only as AtRule;
      const innerRules = inner._getRulesContainer(context);
      if (!innerRules) {
        return;
      }

      // Combine media queries using "and" like Less does.
      const outerPrelude = node._getPrelude(context);
      const innerPrelude = inner._getPrelude(context);
      if (outerPrelude && innerPrelude) {
        // Build a normalized text prelude to avoid double-spacing from nested sequences.
        const outerText = outerPrelude.toTrimmedString().trim();
        const innerText = innerPrelude.toTrimmedString().trim();
        const combined = `${outerText} and ${innerText}`.replace(/[ \t]+/g, ' ').trim();
        setField(node, 'prelude', new Any(combined), context);
      } else {
        setField(node, 'prelude', outerPrelude ?? innerPrelude, context);
      }

      // Replace outer rules with the inner rules (flatten nested media).
      setField(node, 'rules', innerRules, context);
      node.adopt(innerRules);
    };

    return pipe(
      () => {
        // Evaluate prelude in the correct scope (mixin params, vars, etc.).
        const prelude = node._getPrelude(context);
        if (prelude) {
          // Evaluate the prelude in the outer (enclosing) Rules scope, not the nested @media Rules scope.
          // This matches Less behavior for mixin parameters referenced from nested @media preludes.
          const savedRulesContext = context.rulesContext;
          let liftedRulesContext = savedRulesContext;
          // If our current rulesContext is a Rules whose parent is an AtRule, lift to the enclosing Rules.
          if (liftedRulesContext && isNode(liftedRulesContext, N.Rules)) {
            let cursor: any = liftedRulesContext;
            let depth = 0;
            while (getParent(cursor, context) && depth++ < 10) {
              const cursorParent = getParent(cursor, context);
              if (isNode(cursorParent, N.AtRule) && isNode(getParent(cursorParent, context), N.Rules)) {
                cursor = getParent(cursorParent, context);
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
              setField(node, 'prelude', n, context);
              return undefined;
            });
          }
          setField(node, 'prelude', out as Node, context);
        }
      },
      () => {
        let rules = node._getRulesContainer(context);
        if (rules) {
          if (context.opts.collapseNesting) {
            setField(node, 'hoistToRoot', true, context);
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
          if (node.isNestable(context) && !node.isRootOnly(context) && node.isHoisted(context.opts)) {
            const parentRuleset = context.rulesetFrames.at(-1);
            const isCallWrapped = context.callStack.length > 0
              && parentRuleset?.selector
              && !isNode(parentRuleset.selector, N.Nil);
            let existingRules = rules;
            rules = Rules.create([
              Ruleset.create({
                selector: isCallWrapped
                  ? (parentRuleset!.selector.copy(true) as Selector)
                  : Ampersand.create(undefined),
                rules: existingRules
              }, isCallWrapped
                ? {
                    generated: true,
                    ownSelector: parentRuleset!.selector.copy(true) as Selector,
                    resolvedHoistWrapper: true
                  }
                : { generated: true })
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
          if (node.isNestable(context)) {
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
                const onlyRuleSetChild = isNode(bodyToEval.value[0], N.Ruleset);
                const evalOut = bodyToEval.eval(context);
                const doRegister = (r: Rules) => {
                  if (savedRulesetFrames !== undefined) {
                    context.rulesetFrames = savedRulesetFrames;
                  }
                  const finalRules =
                    onlyRuleSetChild && isNode(r.value[0], N.Rules) ? r.value[0] : r;
                  setField(node, 'rules', finalRules, context);
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

          let onlyRuleSetChild = isNode(bodyToEval.value[0], N.Ruleset);

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
              const finalRules = onlyRuleSetChild && isNode(r.value[0], N.Rules) ? r.value[0] : r;
              setField(node, 'rules', finalRules, context);
              tryMergeNestedMedia();

              if (pushedExtendRoot && node.isNestable(context)) {
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
            onlyRuleSetChild && isNode(out.value[0], N.Rules) ? out.value[0] : out;
          setField(node, 'rules', finalRules, context);
          tryMergeNestedMedia();

          if (pushedExtendRoot && node.isNestable(context)) {
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
        let rules = node._getRulesContainer(context);
        if (rules && rules.visibleRules().length === 0) {
          node._removeFlag(F_VISIBLE, context);
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
