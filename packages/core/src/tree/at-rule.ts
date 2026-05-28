import { Node, defineType, F_STATIC, F_VISIBLE, type NodeOptions } from './node.js';
import { Ruleset } from './ruleset.js';
import { Any } from './any.js';
import { Rules } from './rules.js';
import type { Context } from '../context.js';
import { OutputWriter, type FinalPrintOptions, type PrintOptions, getPrintOptions, prepareRenderPrintState } from './util/print.js';
import { isThenable, type MaybePromise, pipe } from '@jesscss/awaitable-pipe';
import { isNode } from './util/is-node.js';
import { N } from './node-type.js';
import { indent, normalizeIndent, serializeRulesContainer } from './util/serialize-helper.js';
import { isRenderBuffer, prepareBufferPrintState, writeRenderText, type RenderBuffer } from './util/render-buffer.js';
import { Interpolated } from './interpolated.js';
import { Nil } from './nil.js';
import { createTriviaMap, emitCommentTriviaAfterNode } from './util/trivia.js';
import { canReuseLeaf, copyWithReusableLeaves, reuseLeaf } from './util/cloning.js';
import { withRulesContext } from './util/context.js';

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
  name: Any | Interpolated;
  /** The prelude */
  prelude?: Node;
  rules?: Rules;
};

type AtRuleBodyRegistrationContext = {
  pushedExtendRoot: boolean;
  savedRulesetFrames: Context['rulesetFrames'] | undefined;
};

type AtRuleBodyFrameState = {
  clearRulesetFrames: boolean;
  restoreRulesetFrames: () => void;
};

type AtRuleBodyRegistrationState = {
  bodyToEval: Rules;
  finalRules: Rules;
  parentExtendRoot?: Rules;
  layerName?: string;
};

type AtRuleBodyState = {
  source: AtRule;
  output: AtRule;
  evaluatedPrelude?: Node;
  evaluatedBody?: Rules;
  registration?: AtRuleBodyRegistrationState;
  hoistToRoot?: boolean;
  frames?: AtRule['frames'];
};

const atRuleBodyRegistrationState = new WeakMap<AtRule, AtRuleBodyRegistrationState>();
const atRuleEvaluatedBody = new WeakMap<AtRule, Rules>();

function liftedAtRulePreludeRulesContext(rulesContext: Context['rulesContext']): Context['rulesContext'] {
  let cursor = rulesContext;
  let depth = 0;
  while (cursor?.parent && depth++ < 10) {
    const parent = cursor.parent;
    const grandparent = parent.parent;
    if (isNode(parent, N.AtRule) && isNode(grandparent, N.Rules)) {
      cursor = grandparent;
      continue;
    }
    break;
  }
  return cursor;
}

function clearRulesetFramesForAtRuleBody(
  context: Context,
  shouldClearRulesetFrames: boolean
): () => void {
  if (!shouldClearRulesetFrames) {
    return () => undefined;
  }
  const savedRulesetFrames = context.rulesetFrames;
  context.rulesetFrames = [];
  return () => {
    context.rulesetFrames = savedRulesetFrames;
  };
}

function createAtRuleBodyFrameState(node: AtRule, context: Context): AtRuleBodyFrameState {
  let clearRulesetFrames = false;
  if (context.bubbleRootAtRules && node.isRootOnly()) {
    const hasRulesetParent = context.frames.some(f => isNode(f, N.Ruleset));
    if (hasRulesetParent) {
      node.hoistToRoot = true;
      clearRulesetFrames = true;
    }
  }
  return {
    clearRulesetFrames,
    restoreRulesetFrames: () => undefined
  };
}

function activateAtRuleBodyFrameState(
  state: AtRuleBodyFrameState,
  context: Context
): () => void {
  state.restoreRulesetFrames = clearRulesetFramesForAtRuleBody(context, state.clearRulesetFrames);
  return state.restoreRulesetFrames;
}

function hasCommentChild(value: unknown): boolean {
  if (isNode(value, N.Comment)) {
    return true;
  }
  if (value instanceof Node) {
    return hasCommentChild(value.value);
  }
  if (Array.isArray(value)) {
    return value.some(hasCommentChild);
  }
  if (value && typeof value === 'object') {
    return Object.values(value).some(hasCommentChild);
  }
  return false;
}

function isAtRuleValue(value: unknown): value is AtRuleValue {
  return Boolean(value && typeof value === 'object' && 'name' in value);
}

function isAtRuleBodyState(value: unknown): value is AtRuleBodyState {
  return Boolean(value && typeof value === 'object' && 'source' in value && 'output' in value);
}

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
  private evaluatedPreludeForBody: Node | undefined;

  protected _valueOf: string | undefined;

  private ownName(name: AtRuleValue['name']): AtRuleValue['name'] {
    const owned = canReuseLeaf(name) ? reuseLeaf(name) : copyWithReusableLeaves(name);
    if (!(owned instanceof Any) && !(owned instanceof Interpolated)) {
      throw new TypeError('Expected at-rule name copy');
    }
    return owned;
  }

  private ownNode(node: Node): Node {
    return canReuseLeaf(node) ? reuseLeaf(node) : copyWithReusableLeaves(node);
  }

  private ownRules(rules: Rules): Rules {
    const owned = canReuseLeaf(rules) ? reuseLeaf(rules) : copyWithReusableLeaves(rules);
    if (!(owned instanceof Rules)) {
      throw new TypeError('Expected at-rule rules copy');
    }
    return owned;
  }

  private deriveAtRule(value: AtRuleValue, sourceValue: AtRuleValue = this.value): AtRule {
    const node = new AtRule(
      {
        name: value.name === sourceValue.name ? this.ownName(value.name) : value.name,
        prelude: value.prelude && value.prelude === sourceValue.prelude ? this.ownNode(value.prelude) : value.prelude,
        rules: value.rules && value.rules === sourceValue.rules ? this.ownRules(value.rules) : value.rules
      },
      this._options ? { ...this._options } : undefined,
      this.location.length ? this.location : undefined,
      this.treeContext
    ).inherit(this);
    node.hoistToRoot = this.hoistToRoot;
    node.frames = this.frames ? [...this.frames] : undefined;
    return node;
  }

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
    const printOptions = getPrintOptions(options);
    return serializeRulesContainer(this, printOptions);
  }

  getRenderRules(): Rules | undefined {
    return atRuleEvaluatedBody.get(this) ?? this.value.rules;
  }

  private storeEvaluatedBody(node: AtRule, finalRules: Rules): void {
    atRuleEvaluatedBody.set(node, finalRules);
  }

  private evalForRender(context: Context): MaybePromise<Node | AtRuleValue | AtRuleBodyState> {
    if (this.evaluated) {
      return this;
    }
    if (this.hasFlag(F_STATIC)) {
      return this;
    }
    if (this.registrationPrepared) {
      return this.eval(context);
    }
    if (!this.value.rules) {
      return this.evalLeafValue(context);
    }
    // Direct render on an unevaluated AtRule is a compatibility/debug API.
    // Public compiler render enters through an evaluated root Rules container.
    return this.evalBodyState(context);
  }

  private evalBodyState(context: Context): MaybePromise<AtRuleBodyState> {
    return pipe(
      () => this.evalBodyPreludeState(context),
      (evaluatedPrelude) => {
        const output = this.deriveAtRule({
          ...this.value,
          prelude: evaluatedPrelude ?? this.value.prelude
        });
        if (evaluatedPrelude) {
          output.evaluatedPreludeForBody = evaluatedPrelude;
        }
        const evaluated = output.eval(context);
        const toState = (node: AtRule | Nil): AtRuleBodyState => {
          if (node instanceof Nil) {
            return {
              source: this,
              output,
              evaluatedPrelude,
              hoistToRoot: output.hoistToRoot,
              frames: output.frames
            };
          }
          return {
            source: this,
            output: node,
            evaluatedPrelude: node.value.prelude,
            evaluatedBody: node.value.rules,
            registration: atRuleBodyRegistrationState.get(node),
            hoistToRoot: node.hoistToRoot,
            frames: node.frames
          };
        };
        return isThenable(evaluated)
          ? evaluated.then(toState)
          : toState(evaluated);
      }
    );
  }

  private evalBodyPreludeState(context: Context): MaybePromise<Node | undefined> {
    const { prelude } = this.value;
    if (!prelude) {
      return undefined;
    }
    return this.evalPreludeValue(prelude, context);
  }

  private evalLeafValue(context: Context): MaybePromise<AtRuleValue> {
    return pipe(
      () => {
        const name = this.value.name;
        return name instanceof Interpolated ? name.eval(context) : name;
      },
      (name) => {
        if (!(name instanceof Any) && !(name instanceof Interpolated)) {
          throw new TypeError('Expected at-rule name to resolve to Any or Interpolated');
        }
        const { prelude } = this.value;
        if (!prelude) {
          return { name };
        }
        const resolvedPrelude = this.evalPreludeValue(prelude, context);
        if (isThenable(resolvedPrelude)) {
          return Promise.resolve(resolvedPrelude).then(resolved => ({ name, prelude: resolved }));
        }
        return {
          name,
          prelude: resolvedPrelude as Node
        };
      }
    );
  }

  private evalPreludeValue(prelude: Node, context: Context): MaybePromise<Node> {
    return withRulesContext(
      context,
      liftedAtRulePreludeRulesContext(context.rulesContext),
      () => prelude.eval(context)
    );
  }

  private renderLeafValue(
    value: AtRuleValue,
    context: Context,
    bufferOrOptions?: RenderBuffer | PrintOptions,
    options?: PrintOptions
  ): string {
    const printOptions = isRenderBuffer(bufferOrOptions)
      ? prepareBufferPrintState(context, options)
      : prepareRenderPrintState(context, bufferOrOptions);
    const renderNode = (node: Node): string => printOptions.writer.preview(() => node.toString(printOptions));
    const nameOut = renderNode(value.name);
    const preludeOut = value.prelude ? renderNode(value.prelude) : '';
    const rendered = preludeOut.trim()
      ? `${nameOut}${/\s$/.test(nameOut) || /^\s/.test(preludeOut) ? '' : ' '}${preludeOut.replace(/^\s+/, '')};`
      : `${nameOut};`;
    return isRenderBuffer(bufferOrOptions)
      ? writeRenderText(bufferOrOptions, rendered)
      : rendered;
  }

  private resolveLeafValue(value: AtRuleValue): AtRule {
    const node = new AtRule(
      {
        name: value.name === this.value.name ? this.ownName(value.name) : value.name,
        prelude: value.prelude && value.prelude === this.value.prelude ? this.ownNode(value.prelude) : value.prelude
      },
      this._options ? { ...this._options } : undefined,
      this.location.length ? this.location : undefined,
      this.treeContext
    ).inherit(this);
    node.hoistToRoot = this.hoistToRoot;
    node.frames = this.frames ? [...this.frames] : undefined;
    return node;
  }

  override render(context: Context, buffer: RenderBuffer, options?: PrintOptions): MaybePromise<string>;
  override render(context: Context, options?: PrintOptions): string;
  override render(context: Context, bufferOrOptions?: RenderBuffer | PrintOptions, options?: PrintOptions): string | MaybePromise<string> {
    const renderEvaluatedAtRule = (node: AtRule): string => {
      if (isRenderBuffer(bufferOrOptions)) {
        return writeRenderText(
          bufferOrOptions,
          serializeRulesContainer(node, prepareBufferPrintState(context, options))
        );
      }
      return serializeRulesContainer(node, prepareRenderPrintState(context, bufferOrOptions));
    };
    return pipe(
      () => this.evalForRender(context),
      (node) => {
        if (node instanceof Nil) {
          return '';
        }
        if (node instanceof AtRule) {
          return renderEvaluatedAtRule(node);
        }
        if (isAtRuleBodyState(node)) {
          return renderEvaluatedAtRule(node.output);
        }
        if (isAtRuleValue(node)) {
          return this.renderLeafValue(node, context, bufferOrOptions, options);
        }
        return isRenderBuffer(bufferOrOptions)
          ? node.render(context, bufferOrOptions, options)
          : node.render(context, bufferOrOptions);
      }
    );
  }

  /**
   * Prepare name identity and body registration.
   * Prelude evaluation stays in evalNode so live-scope lookups stay correct.
   */
  override prepareRegistration(context: Context): MaybePromise<AtRule | Nil> {
    if (!this.registrationPrepared) {
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

    const node = this.deriveAtRule(this.value);
    node.registrationPrepared = true;

    const maybeKey = node.value.name.eval(context);
    if (isThenable(maybeKey)) {
      return Promise.resolve(maybeKey).then((key) => {
        if (!(key instanceof Any)) {
          throw new TypeError('Expected interpolated at-rule name to resolve to Any');
        }
        node.adopt(key);
        node.value.name = key;
        return node;
      });
    }

    if (!(maybeKey instanceof Any)) {
      throw new TypeError('Expected interpolated at-rule name to resolve to Any');
    }
    node.adopt(maybeKey);
    node.value.name = maybeKey;
    return node;
  }

  private _prepareAtRuleRegistration(node: AtRule, context: Context, original: AtRule): MaybePromise<AtRule | Nil> {
    const importResult = this._prepareAtRuleImportQueue(node, context);
    if (importResult) {
      return importResult;
    }
    const { rules } = node.value;
    // Defer prelude evaluation to evalNode so variable lookups happen in the correct
    // live scope (e.g. mixin parameters referenced from nested @media preludes).
    return this._prepareAtRuleBodyRegistration(node, context, original, rules);
  }

  private _prepareAtRuleImportQueue(node: AtRule, context: Context): Nil | undefined {
    // Preserve @import prelude as-authored (including comments). Evaluation here can
    // normalize/strip comment tokens inside the prelude, but less.js expects them preserved.
    const atRuleName = String(node.value.name.valueOf?.() ?? node.value.name ?? '').trim();
    if (atRuleName !== '@import') {
      return undefined;
    }
    // Reference branches are traversed for symbol/extend resolution, but plain
    // CSS @import hoisting must remain a visible-output concern only.
    this._queueTopImport(node, context);
    node.registrationPrepared = true;
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
        node = original.deriveAtRule(original.value);
      }
      node.registrationPrepared = true;
      return node;
    };
    const finalize = (): AtRule => {
      node.registrationPrepared = true;
      return node;
    };
    // Depth-first: prepare child rules immediately so all nested rulesets/extends
    // are registered in source order before we process extends.
    if (rules && !rules.registrationPrepared) {
      const saved = this._setupAtRuleBodyRegistrationContext(node, rules, context);
      let preparedRules: MaybePromise<Node>;
      try {
        preparedRules = rules.prepareRegistration(context);
      } catch (error) {
        this._restoreAtRuleBodyRegistrationContext(context, saved);
        throw error;
      }
      if (isThenable(preparedRules)) {
        return preparedRules.then(
          (resolvedRules) => {
            this._restoreAtRuleBodyRegistrationContext(context, saved);
            if (!(resolvedRules instanceof Rules)) {
              throw new TypeError('Expected at-rule body registration prep to return Rules');
            }
            if (resolvedRules !== rules) {
              ensureDerived().value.rules = resolvedRules;
            }
            return finalize();
          },
          (error) => {
            this._restoreAtRuleBodyRegistrationContext(context, saved);
            throw error;
          }
        );
      }
      this._restoreAtRuleBodyRegistrationContext(context, saved);
      if (!(preparedRules instanceof Rules)) {
        throw new TypeError('Expected at-rule body registration prep to return Rules');
      }
      if (preparedRules !== rules) {
        ensureDerived().value.rules = preparedRules;
      }
    }
    return finalize();
  }

  private _setupAtRuleBodyRegistrationContext(
    node: AtRule,
    rules: Rules,
    context: Context
  ): AtRuleBodyRegistrationContext {
    // For nestable at-rules we do NOT push the original here. The body's Rules registration prep
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

  private _registerEvaluatedNestableBody(
    node: AtRule,
    context: Context,
    state: AtRuleBodyRegistrationState
  ): AtRuleBodyRegistrationState {
    context.extendRoots.popExtendRoot();
    const layerName = context.extendRoots.takeLayerName(node);
    const registration: AtRuleBodyRegistrationState = {
      ...state,
      layerName
    };
    const parent = registration.parentExtendRoot ?? context.root ?? undefined;
    context.extendRoots.registerRoot(registration.bodyToEval, parent as Rules | undefined, { layerName });
    registerInnerExtendRootIfHoisted(registration.bodyToEval, context, layerName);
    if (registration.finalRules !== registration.bodyToEval) {
      context.extendRoots.registerRoot(registration.finalRules, registration.bodyToEval, { layerName });
      registerInnerExtendRootIfHoisted(registration.finalRules, context, layerName);
    }
    context.extendRoots.pushExtendRoot(registration.bodyToEval);
    context.extendRoots.popExtendRoot();
    atRuleBodyRegistrationState.set(node, registration);
    return registration;
  }

  /** Render the opening of this at-rule (name and prelude) */
  getHeaderString(options: FinalPrintOptions, withoutComments?: boolean): string {
    let { name, prelude } = this.value;
    const rules = this.getRenderRules();

    let idt = indent(options.depth);
    let out = idt;

    if (withoutComments && (hasCommentChild(name) || hasCommentChild(prelude))) {
      name = this.ownName(name);
      if (prelude) {
        prelude = this.ownNode(prelude);
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
      if (preludeStartsWithSpace) {
        finalPreludeOut = preludeOut.replace(/^\s+/, nameEndsWithSpace ? '' : ' ');
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

    // @plugin is handled by the Less compatibility plugin during preparation.
    // If we reach eval and it's still visible, no plugin processed it.
    const atName = String(node.value?.name?.valueOf?.() ?? '');
    if (atName === '@plugin' && node.visible) {
      throw new Error('@plugin is only supported when using the Less compatibility plugin (@jesscss/plugin-less-compat).');
    }

    const bodyFrameState = createAtRuleBodyFrameState(node, context);

    // Store frames snapshot for hoisting serialization
    if (context.opts.collapseNesting || node.hoistToRoot) {
      node.frames = [...context.frames];
    }

    return pipe(
      () => {
        // Evaluate prelude in the correct scope (mixin params, vars, etc.).
        let { prelude } = node.value;
        if (prelude) {
          const evaluatedPrelude = node.evaluatedPreludeForBody;
          if (evaluatedPrelude) {
            node.value.prelude = evaluatedPrelude;
            return undefined;
          }
          // Evaluate the prelude in the outer (enclosing) Rules scope, not the nested @media Rules scope.
          // This matches Less behavior for mixin parameters referenced from nested @media preludes.
          const out = this.evalPreludeValue(prelude, context);
          if (isThenable(out)) {
            return Promise.resolve(out).then(
              (n) => {
                node.value.prelude = n;
                return undefined;
              }
            );
          }
          node.value.prelude = out;
        }
      },
      () => {
        let { rules } = node.value;
        if (rules) {
          if (context.opts.collapseNesting && node.isNestable()) {
            node.hoistToRoot = true;
          }
          const frameCount = context.frames.length;
          const extendRootStackLength = context.extendRoots.extendRootStack.length;
          let restoreRulesetFrames = () => undefined;
          const restoreBodyEvalContext = () => {
            context.frames.length = frameCount;
            restoreRulesetFrames();
            while (context.extendRoots.extendRootStack.length > extendRootStackLength) {
              context.extendRoots.popExtendRoot();
            }
          };
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
            let preparedRules: MaybePromise<Node>;
            try {
              preparedRules = rules.prepareRegistration(context);
            } catch (error) {
              restoreBodyEvalContext();
              throw error;
            }
            if (isThenable(preparedRules)) {
              return preparedRules.then((resolved) => {
                if (!(resolved instanceof Rules)) {
                  restoreBodyEvalContext();
                  throw new TypeError('Expected at-rule body registration prep to return Rules');
                }
                bodyToEval = resolved;
                context.extendRoots.pushExtendRoot(bodyToEval);
                pushedExtendRoot = true;
                restoreRulesetFrames = activateAtRuleBodyFrameState(bodyFrameState, context);
                const onlyRuleSetChild = isNode(bodyToEval.value[0], N.Ruleset);
                let evalOut: MaybePromise<Rules>;
                try {
                  evalOut = bodyToEval.eval(context);
                } catch (error) {
                  restoreBodyEvalContext();
                  throw error;
                }
                const doRegister = (r: Rules) => {
                  restoreRulesetFrames();
                  const finalRules =
                    onlyRuleSetChild && isNode(r.value[0], N.Rules) ? r.value[0] : r;
                  this.storeEvaluatedBody(node, finalRules);
                  this._registerEvaluatedNestableBody(node, context, {
                    bodyToEval,
                    finalRules,
                    parentExtendRoot
                  });
                  return node;
                };
                if (isThenable(evalOut)) {
                  return (evalOut as Promise<Rules>).then(doRegister, (error) => {
                    restoreBodyEvalContext();
                    throw error;
                  });
                }
                return doRegister(evalOut as Rules);
              }, (error) => {
                restoreBodyEvalContext();
                throw error;
              });
            }
            if (!(preparedRules instanceof Rules)) {
              restoreBodyEvalContext();
              throw new TypeError('Expected at-rule body registration prep to return Rules');
            }
            bodyToEval = preparedRules;
            context.extendRoots.pushExtendRoot(bodyToEval);
            pushedExtendRoot = true;
          }

          let onlyRuleSetChild = isNode(bodyToEval.value[0], N.Ruleset);

          // For root-only at-rules that are hoisted, clear rulesetFrames
          // so internal rulesets don't inherit parent selectors
          restoreRulesetFrames = activateAtRuleBodyFrameState(bodyFrameState, context);

          let out: MaybePromise<Rules>;
          try {
            out = bodyToEval.eval(context);
          } catch (error) {
            restoreBodyEvalContext();
            throw error;
          }
          if (isThenable(out)) {
            return (out as Promise<Rules>).then((r) => {
              // Restore rulesetFrames
              restoreRulesetFrames();
              // If the only rule was a ruleset, and it evaluated to Rules,
              // discard the extra rules wrapper
              const finalRules = onlyRuleSetChild && isNode(r.value[0], N.Rules) ? r.value[0] : r;
              this.storeEvaluatedBody(node, finalRules);
              if (pushedExtendRoot && node.isNestable()) {
                this._registerEvaluatedNestableBody(node, context, {
                  bodyToEval,
                  finalRules,
                  parentExtendRoot
                });
              }

              return node;
            }, (error) => {
              restoreBodyEvalContext();
              throw error;
            });
          }
          // Restore rulesetFrames (sync path)
          restoreRulesetFrames();

          const finalRules =
            onlyRuleSetChild && isNode(out.value[0], N.Rules) ? out.value[0] : out;
          this.storeEvaluatedBody(node, finalRules);
          if (pushedExtendRoot && node.isNestable()) {
            this._registerEvaluatedNestableBody(node, context, {
              bodyToEval,
              finalRules,
              parentExtendRoot
            });
          }
        }
        return node;
      },
      () => {
        // Pop the frame that was kept on the stack during rules evaluation so children could access it.
        context.frames.pop();
        let rules = node.getRenderRules();
        if (rules && rules.visibleRules().length === 0) {
          node.removeFlag(F_VISIBLE);
        }
        return node;
      }
    ) as MaybePromise<AtRule>;
  }

  override resolve(context: Context): MaybePromise<Node> {
    if (this.evaluated) {
      return this;
    }
    if (this.hasFlag(F_STATIC)) {
      return this;
    }
    if (this.registrationPrepared) {
      return this.eval(context);
    }
    if (!this.value.rules) {
      return pipe(
        () => this.evalLeafValue(context),
        value => this.resolveLeafValue(value)
      );
    }
    return pipe(
      () => this.evalBodyState(context),
      state => state.output
    );
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
