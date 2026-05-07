import { Node, defineType, F_VISIBLE, type NodeOptions } from './node.js';
import { Ruleset } from './ruleset.js';
import { Any } from './any.js';
import { Rules } from './rules.js';
import type { Context } from '../context.js';
import { OutputWriter, type FinalPrintOptions, type PrintOptions, getPrintOptions } from './util/print.js';
import { isThenable, type MaybePromise, pipe } from '@jesscss/awaitable-pipe';
import { isNode } from './util/is-node.js';
import { N } from './node-type.js';
import { indent, normalizeIndent, serializeRulesContainer } from './util/serialize-helper.js';
import { Interpolated } from './interpolated.js';
import { Nil } from './nil.js';
import { createTriviaMap, emitCommentTriviaAfterNode } from './util/trivia.js';

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
  const innerRules = first.value.rules;
  if (!innerRules || !isNode(innerRules, N.Rules)) {
    return;
  }
  context.extendRoots.registerRoot(innerRules, wrapperRules, { layerName });
}

export type AtRuleValue = {
  name: Any<'atkeyword'>;
  /** The prelude */
  prelude?: Node;
  rules?: Rules;
};

type AtRuleBodyRegistrationContext = {
  pushedExtendRoot: boolean;
  savedRulesetFrames: Context['rulesetFrames'] | undefined;
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
    const atRuleName = this.value.name.valueOf();
    return NESTABLE_AT_RULES.some(name => name === atRuleName);
  }

  /**
   * For legacy collapseNesting, will push ruleset to root silently.
   */
  isRootOnly() {
    const atRuleName = this.value.name.valueOf();
    return ROOT_ONLY_AT_RULES.some(name => name === atRuleName);
  }

  isHoisted(opts: { collapseNesting?: boolean }) {
    return this.hoistToRoot ?? Boolean(opts.collapseNesting && this.isNestable());
  }

  override toTrimmedString(options?: PrintOptions): string {
    options = getPrintOptions(options);
    return serializeRulesContainer(this, options);
  }

  /**
   * Prepare name identity and body registration.
   * Prelude evaluation stays in evalNode so live-scope lookups stay correct.
   */
  override preEval(context: Context): MaybePromise<AtRule | Nil> {
    if (!this.preEvaluated) {
      const prepared = this._prepareAtRuleNameIdentity(context);
      if (isThenable(prepared)) {
        return (prepared as Promise<AtRule>).then(node => this._prepareAtRuleRegistration(node, context, this));
      }
      return this._prepareAtRuleRegistration(prepared as AtRule, context, this);
    }
    return this;
  }

  private _prepareAtRuleNameIdentity(context: Context): MaybePromise<AtRule> {
    if (!(this.value.name instanceof Interpolated)) {
      return this;
    }

    const node = this.clone(false) as AtRule;
    node.preEvaluated = true;

    const maybeKey = node.value.name.eval(context);
    if (isThenable(maybeKey)) {
      return Promise.resolve(maybeKey).then((key) => {
        if (!(key instanceof Any)) {
          throw new TypeError('Expected interpolated at-rule name to resolve to Any');
        }
        node.value.name = key;
        return node;
      });
    }

    if (!(maybeKey instanceof Any)) {
      throw new TypeError('Expected interpolated at-rule name to resolve to Any');
    }
    node.value.name = maybeKey;
    return node;
  }

  private _prepareAtRuleRegistration(node: AtRule, context: Context, original: AtRule): MaybePromise<AtRule | Nil> {
    const importResult = this._prepareAtRuleImportQueue(node, context);
    if (importResult) {
      return importResult;
    }
    const { prelude, rules } = node.value;
    // Defer prelude evaluation to evalNode so variable lookups happen in the correct
    // live scope (e.g. mixin parameters referenced from nested @media preludes).
    if (prelude) {
      node.value.prelude = prelude;
    }
    return this._prepareAtRuleBodyRegistration(node, context, original, rules);
  }

  private _prepareAtRuleImportQueue(node: AtRule, context: Context): Nil | undefined {
    const { prelude } = node.value;
    // Preserve @import prelude as-authored (including comments). Evaluation here can
    // normalize/strip comment tokens inside the prelude, but less.js expects them preserved.
    const atRuleName = String(node.value.name.valueOf?.() ?? node.value.name ?? '').trim();
    if (atRuleName !== '@import') {
      return undefined;
    }
    if (prelude) {
      node.value.prelude = prelude;
    }
    // Reference branches are traversed for symbol/extend resolution, but plain
    // CSS @import hoisting must remain a visible-output concern only.
    this._queueTopImport(node, context);
    node.preEvaluated = true;
    return new Nil();
  }

  private _prepareAtRuleBodyRegistration(
    node: AtRule,
    context: Context,
    original: AtRule,
    rules: Rules | undefined
  ): MaybePromise<AtRule> {
    const ensureDerived = (): AtRule => {
      if (node === original) {
        node = original.clone(false) as AtRule;
      }
      node.preEvaluated = true;
      return node;
    };
    const finalize = (): AtRule => {
      node.preEvaluated = true;
      return node;
    };
    // Depth-first: preEval child rules immediately so all nested rulesets/extends
    // are registered in source order before we process extends.
    if (rules && !rules.preEvaluated) {
      const saved = this._setupAtRuleBodyRegistrationContext(node, rules, context);
      let preEvaldRules: MaybePromise<Rules>;
      try {
        preEvaldRules = rules.preEval(context);
      } catch (error) {
        this._restoreAtRuleBodyRegistrationContext(context, saved);
        throw error;
      }
      if (isThenable(preEvaldRules)) {
        return (preEvaldRules as Promise<Rules>)
          .then((evaldRules) => {
            this._restoreAtRuleBodyRegistrationContext(context, saved);
            if (evaldRules !== rules) {
              ensureDerived().value.rules = evaldRules;
            }
            return finalize();
          })
          .catch((error) => {
            this._restoreAtRuleBodyRegistrationContext(context, saved);
            throw error;
          });
      }
      this._restoreAtRuleBodyRegistrationContext(context, saved);
      if (preEvaldRules !== rules) {
        ensureDerived().value.rules = preEvaldRules as Rules;
      }
    }
    return finalize();
  }

  private _setupAtRuleBodyRegistrationContext(
    node: AtRule,
    rules: Rules,
    context: Context
  ): AtRuleBodyRegistrationContext {
    // For nestable at-rules we do NOT push the original here. The body's Rules.preEval
    // pushes the clone (the Rules that ends up in the tree) so rulesets register to it.
    // Pushing the original would leave the clone's registry empty (extend + collapseNesting bug).
    const pushedExtendRoot = !node.isNestable();
    if (pushedExtendRoot) {
      context.extendRoots.pushExtendRoot(rules);
    }
    // Root-only at-rules (@keyframes, @font-face, etc.): do not let parent ruleset frames
    // pierce into the body — clear rulesetFrames so 0%/100% etc. are not combined with .parent.
    const savedRulesetFrames = node.isRootOnly() ? context.rulesetFrames : undefined;
    if (savedRulesetFrames !== undefined) {
      context.rulesetFrames = [];
    }
    return {
      pushedExtendRoot,
      savedRulesetFrames
    };
  }

  private _restoreAtRuleBodyRegistrationContext(
    context: Context,
    saved: AtRuleBodyRegistrationContext
  ): void {
    if (saved.savedRulesetFrames !== undefined) {
      context.rulesetFrames = saved.savedRulesetFrames;
    }
    if (saved.pushedExtendRoot) {
      context.extendRoots.popExtendRoot();
    }
  }

  private _queueTopImport(node: AtRule, context: Context): void {
    if (context.inReferenceImportScope) {
      return;
    }
    const topImports = (context.topImports ??= []);
    const nodeLoc = node.location?.join(':') ?? '';
    const nodeSig = `${node.value.name.valueOf?.() ?? node.value.name}:${node.value.prelude?.valueOf?.() ?? ''}`;
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
          && `${queued.value.name.valueOf?.() ?? queued.value.name}:${queued.value.prelude?.valueOf?.() ?? ''}` === nodeSig
        )
      );
    });
    if (!alreadyQueued) {
      topImports.push(node);
    }
  }

  private _extractAndStoreLayerName(node: AtRule, context: Context): void {
    const atRuleName = node.value.name?.toTrimmedString?.() ?? node.value.name?.toString?.() ?? '';
    if (atRuleName === '@layer' && node.value.prelude) {
      const preludeStr = String(node.value.prelude.valueOf?.() ?? node.value.prelude.toTrimmedString?.() ?? node.value.prelude.toString?.() ?? '');
      if (preludeStr) {
        let parentLayerName: string | undefined;
        for (let i = context.frames.length - 2; i >= 0; i--) {
          const frame = context.frames[i]!;
          const frameContainsNode = Boolean(
            isNode(frame, N.AtRule)
            && frame.value.rules?.value?.some(child =>
              child === node
              || child === node.sourceNode
              || child.sourceNode === node
              || child.sourceNode === node.sourceNode
            )
          );
          if (isNode(frame, N.AtRule) && frame.value.name?.toTrimmedString?.() === '@layer' && frameContainsNode) {
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
    let { name, prelude, rules } = this.value;

    let idt = indent(options.depth);
    let out = idt;

    if (withoutComments) {
      name = name.copy(true) as Any<'atkeyword'>;
      if (prelude) {
        prelude = prelude.copy(true) as Node;
      }
    }

    const emptyHeaderTrivia = () => createTriviaMap();
    const captureWithoutHeaderTrivia = (fn: () => string): string => {
      const savedTrivia = options.trivia;
      if (withoutComments) {
        options.trivia = emptyHeaderTrivia();
      }
      try {
        return fn();
      } finally {
        options.trivia = savedTrivia;
      }
    };
    const printDetached = (printOptions: PrintOptions, fn: (nextOptions: PrintOptions) => void): string => {
      const writer = new OutputWriter();
      fn({
        ...printOptions,
        writer
      });
      return writer.toString();
    };

    const nameOut = captureWithoutHeaderTrivia(() => printDetached(options, nextOptions => name.toString(nextOptions)));
    const nameEndsWithSpace = /\s$/.test(nameOut);
    if (prelude) {
      const preludeTrivia = withoutComments
        ? emptyHeaderTrivia()
        : options.trivia ?? prelude.treeContext?.opts?.trivia;
      const preludePrintOptions = options.context && preludeTrivia
        ? {
            ...options,
            context: undefined,
            trivia: preludeTrivia,
            emittedTrivia: options.emittedTrivia
          }
        : options;
      const preludeOut = captureWithoutHeaderTrivia(() => printDetached(preludePrintOptions, nextOptions => prelude.toString(nextOptions)));
      if (!preludeOut.trim()) {
        out += nameOut;
        if (rules) {
          out = normalizeIndent(out.replace(/\s+$/, '') + ' {', idt) + '\n';
        } else {
          out = normalizeIndent(out.replace(/\s+$/, '') + ';', idt);
        }
        return out;
      }
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
      const preludePost = withoutComments
        ? ''
        : printDetached(options, nextOptions => emitCommentTriviaAfterNode(prelude, nextOptions));
      out += preludePost;
      if (rules) {
        const preludeEndsWithSpace = /\s$/.test(preludeOut + preludePost);
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
        out = normalizeIndent(out.replace(/\s+$/, '') + ' {', idt) + '\n';
      } else {
        out = normalizeIndent(out + ';', idt);
      }
    }
    return out;
  }

  override evalNode(context: Context): MaybePromise<AtRule | Nil> {
    let node = this as AtRule;

    // @plugin is handled by the Less compatibility plugin (preEval). If we reach eval and it's still visible, no plugin processed it.
    const atName = String(node.value?.name?.valueOf?.() ?? '');
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

    return pipe(
      () => {
        // Evaluate prelude in the correct scope (mixin params, vars, etc.).
        let { prelude } = node.value;
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
              node.value.prelude = n;
              return undefined;
            });
          }
          node.value.prelude = out as Node;
        }
      },
      () => {
        let { rules } = node.value;
        if (rules) {
          if (context.opts.collapseNesting && node.isNestable()) {
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

          // Register extend root for nestable at-rules (including @layer).
          // Prepare first so we push and later register the Rules that is actually evaluated
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
                const onlyRuleSetChild = isNode(bodyToEval.value[0], N.Ruleset);
                const evalOut = bodyToEval.eval(context);
                const doRegister = (r: Rules) => {
                  if (savedRulesetFrames !== undefined) {
                    context.rulesetFrames = savedRulesetFrames;
                  }
                  const finalRules =
                    onlyRuleSetChild && isNode(r.value[0], N.Rules) ? r.value[0] : r;
                  node.value.rules = finalRules;
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
              node.value.rules = finalRules;
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
            onlyRuleSetChild && isNode(out.value[0], N.Rules) ? out.value[0] : out;
          node.value.rules = finalRules;
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
        // Pop the frame that was kept on the stack during rules evaluation so children could access it.
        context.frames.pop();
        let rules = node.value.rules;
        if (rules && rules.visibleRules().length === 0) {
          this.removeFlag(F_VISIBLE);
        }
        return node;
      }
    ) as MaybePromise<AtRule>;
  }

  override resolve(context: Context): MaybePromise<Node> {
    return this.clone(false).eval(context);
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
  //   context.indent++
  //   out.add(`  name: ${JSON.stringify(this.name)}`)
  //   const value = this.value
  //   if (value) {
  //     out.add(`,\n  value: `)
  //     value.toModule(context, out)
  //   }
  //   const rules = this.rules
  //   if (rules) {
  //     out.add(`,\n  rules: `)
  //     rules.toModule(context, out)
  //   }
  //   context.indent--
  //   out.add(`\n},${JSON.stringify(this.location)})`)
  // }
}

export const atrule = defineType(AtRule, 'AtRule');
