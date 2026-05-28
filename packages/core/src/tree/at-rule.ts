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
  output?: AtRuleBodyOutputState;
};

type AtRuleBodyOutputState = {
  hoistToRoot?: boolean;
  frames?: AtRule['frames'];
};

type AtRuleBodyRuntimeState = {
  evaluatedBody?: Rules;
  evaluatedPrelude?: Node;
  output?: AtRuleBodyOutputState;
};

type AtRuleBodyEvalContextState = {
  evalFrame: AtRule;
  frameState: AtRuleBodyFrameState;
  frameCount: number;
  extendRootStackLength: number;
  writeEvaluatedPrelude: boolean;
  writeOutputStateToNode: boolean;
};

type AtRuleBodyEvalRecord = {
  source: AtRule;
  evalFrame: AtRule;
  evaluatedPrelude?: Node;
  contextState: AtRuleBodyEvalContextState;
};

type AtRuleBodyRegistrationState = {
  bodyToEval: Rules;
  finalRules: Rules;
  parentExtendRoot?: Rules;
  layerName?: string;
};

type AtRuleBodyEvalPrepState = {
  bodyToEval: Rules;
  parentExtendRoot?: Rules;
  pushedExtendRoot: boolean;
};

type AtRuleBodyRenderState = {
  kind: 'body-render';
  source: AtRule;
  evaluatedPrelude?: Node;
  evaluatedBody?: Rules;
  output?: AtRuleBodyOutputState;
};

type AtRuleLeafState = {
  kind: 'leaf-render';
  source: AtRule;
  value: AtRuleValue;
};

type AtRuleBodyEvalResult = {
  evalFrame: AtRule;
  node: AtRule | Nil;
  evaluatedPrelude?: Node;
  evaluatedBody?: Rules;
  output?: AtRuleBodyOutputState;
};

const atRuleBodyRuntimeState = new WeakMap<AtRule, AtRuleBodyRuntimeState>();

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
  let output: AtRuleBodyOutputState | undefined;
  if (context.bubbleRootAtRules && node.isRootOnly()) {
    const hasRulesetParent = context.frames.some(f => isNode(f, N.Ruleset));
    if (hasRulesetParent) {
      output = { hoistToRoot: true };
      clearRulesetFrames = true;
    }
  }
  return {
    clearRulesetFrames,
    restoreRulesetFrames: () => undefined,
    output
  };
}

function activateAtRuleBodyFrameState(
  state: AtRuleBodyFrameState,
  context: Context
): () => void {
  state.restoreRulesetFrames = clearRulesetFramesForAtRuleBody(context, state.clearRulesetFrames);
  return state.restoreRulesetFrames;
}

function createAtRuleBodyEvalContextState(
  node: AtRule,
  context: Context,
  options: {
    writeEvaluatedPrelude?: boolean;
    writeOutputStateToNode?: boolean;
  } = {}
): AtRuleBodyEvalContextState {
  return {
    evalFrame: node,
    frameState: createAtRuleBodyFrameState(node, context),
    frameCount: context.frames.length,
    extendRootStackLength: context.extendRoots.extendRootStack.length,
    writeEvaluatedPrelude: options.writeEvaluatedPrelude ?? true,
    writeOutputStateToNode: options.writeOutputStateToNode ?? true
  };
}

function activateAtRuleBodyEvalContextState(
  state: AtRuleBodyEvalContextState,
  context: Context
): () => void {
  return activateAtRuleBodyFrameState(state.frameState, context);
}

function restoreAtRuleBodyEvalContextState(
  state: AtRuleBodyEvalContextState,
  context: Context
): void {
  context.frames.length = state.frameCount;
  state.frameState.restoreRulesetFrames();
  while (context.extendRoots.extendRootStack.length > state.extendRootStackLength) {
    context.extendRoots.popExtendRoot();
  }
}

function setAtRuleBodyEvalOutput(
  node: AtRule,
  output: AtRuleBodyOutputState
): void {
  updateAtRuleBodyRuntimeState(node, {
    output: {
      ...atRuleBodyRuntimeState.get(node)?.output,
      ...output
    }
  });
}

function updateAtRuleBodyRuntimeState(
  node: AtRule,
  state: AtRuleBodyRuntimeState
): AtRuleBodyRuntimeState {
  const next = {
    ...atRuleBodyRuntimeState.get(node),
    ...state
  };
  atRuleBodyRuntimeState.set(node, next);
  return next;
}

function runAtRuleBodyRuntimeState<T>(
  node: AtRule,
  state: AtRuleBodyRuntimeState,
  work: () => T
): T {
  const priorRuntime = atRuleBodyRuntimeState.get(node);
  try {
    updateAtRuleBodyRuntimeState(node, state);
    return work();
  } finally {
    if (priorRuntime) {
      atRuleBodyRuntimeState.set(node, priorRuntime);
    } else {
      atRuleBodyRuntimeState.delete(node);
    }
  }
}

function setAtRuleBodyEvalPrelude(
  state: AtRuleBodyEvalContextState,
  prelude: Node
): void {
  updateAtRuleBodyRuntimeState(state.evalFrame, { evaluatedPrelude: prelude });
  if (state.writeEvaluatedPrelude) {
    state.evalFrame.value.prelude = prelude;
  }
}

function storeAtRuleBodyEvalRules(
  state: AtRuleBodyEvalContextState,
  finalRules: Rules
): void {
  updateAtRuleBodyRuntimeState(state.evalFrame, { evaluatedBody: finalRules });
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

function isAtRuleBodyRenderState(value: unknown): value is AtRuleBodyRenderState {
  return Boolean(value && typeof value === 'object' && Reflect.get(value, 'kind') === 'body-render');
}

function isAtRuleLeafState(value: unknown): value is AtRuleLeafState {
  return Boolean(value && typeof value === 'object' && Reflect.get(value, 'kind') === 'leaf-render');
}

function readAtRuleBodyEvalRecordResult(
  record: AtRuleBodyEvalRecord,
  node: AtRule | Nil
): AtRuleBodyEvalResult {
  const outputNode = node instanceof Nil ? record.evalFrame : node;
  const runtime = atRuleBodyRuntimeState.get(outputNode);
  return {
    evalFrame: record.evalFrame,
    node,
    evaluatedPrelude: runtime?.evaluatedPrelude ?? record.evaluatedPrelude,
    evaluatedBody: runtime?.evaluatedBody,
    output: runtime?.output
  };
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
    return atRuleBodyRuntimeState.get(this)?.output?.hoistToRoot ?? this.hoistToRoot ?? Boolean(opts.collapseNesting && this.isNestable());
  }

  getRenderFrames(): AtRule['frames'] {
    return atRuleBodyRuntimeState.get(this)?.output?.frames ?? this.frames;
  }

  override toTrimmedString(options?: PrintOptions): string {
    const printOptions = getPrintOptions(options);
    return serializeRulesContainer(this, printOptions);
  }

  getRenderRules(): Rules | undefined {
    return atRuleBodyRuntimeState.get(this)?.evaluatedBody ?? this.value.rules;
  }

  private evalForRender(context: Context): MaybePromise<Node | AtRuleLeafState | AtRuleBodyRenderState> {
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
        value => this.createLeafRenderState(value)
      );
    }
    // Direct render on an unevaluated AtRule is a compatibility/debug API.
    // Public compiler render enters through an evaluated root Rules container.
    return this.evalBodyState(context);
  }

  private evalBodyResult(
    context: Context,
    options: {
      writeEvaluatedPrelude?: boolean;
      writeOutputStateToNode?: boolean;
    } = {}
  ): MaybePromise<AtRuleBodyEvalResult> {
    return pipe(
      () => this.evalBodyPreludeState(context),
      (evaluatedPrelude) => {
        const record = this.createBodyEvalRecord(context, evaluatedPrelude, options);
        let evaluated: MaybePromise<Node>;
        try {
          evaluated = record.evalFrame.evalBodyNode(context, record.contextState);
        } catch (error) {
          throw error;
        }
        const finish = (node: Node): AtRuleBodyEvalResult => {
          if (!(node instanceof AtRule) && !(node instanceof Nil)) {
            throw new TypeError('Expected at-rule body eval to return AtRule or Nil');
          }
          return readAtRuleBodyEvalRecordResult(record, node);
        };
        if (isThenable(evaluated)) {
          return evaluated.then(finish);
        }
        return finish(evaluated);
      }
    );
  }

  private createBodyEvalRecord(
    context: Context,
    evaluatedPrelude: Node | undefined,
    options: {
      writeEvaluatedPrelude?: boolean;
      writeOutputStateToNode?: boolean;
    }
  ): AtRuleBodyEvalRecord {
    const evalFrame = this.deriveAtRule(this.value);
    if (evaluatedPrelude) {
      updateAtRuleBodyRuntimeState(evalFrame, { evaluatedPrelude });
    }
    return {
      source: this,
      evalFrame,
      evaluatedPrelude,
      contextState: createAtRuleBodyEvalContextState(evalFrame, context, {
        writeEvaluatedPrelude: options.writeEvaluatedPrelude,
        writeOutputStateToNode: options.writeOutputStateToNode
      })
    };
  }

  private evalBodyState(context: Context): MaybePromise<AtRuleBodyRenderState> {
    return pipe(
      () => this.evalBodyResult(context, {
        writeEvaluatedPrelude: false,
        writeOutputStateToNode: false
      }),
      result => this.createBodyRenderState(result)
    );
  }

  private createBodyRenderState(result: AtRuleBodyEvalResult): AtRuleBodyRenderState {
    if (result.node instanceof Nil) {
      return {
        kind: 'body-render',
        source: this,
        evaluatedPrelude: result.evaluatedPrelude,
        output: result.output
      };
    }
    return {
      kind: 'body-render',
      source: this,
      evaluatedPrelude: result.evaluatedPrelude,
      evaluatedBody: result.evaluatedBody ?? result.node.value.rules,
      output: result.output
    };
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

  private createLeafRenderState(value: AtRuleValue): AtRuleLeafState {
    return {
      kind: 'leaf-render',
      source: this,
      value
    };
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

  private resolveBodyResult(result: AtRuleBodyEvalResult): AtRule {
    const node = result.node instanceof Nil ? result.evalFrame : result.node;
    if (result.evaluatedPrelude) {
      node.value.prelude = result.evaluatedPrelude;
    }
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
    const renderBodyState = (state: AtRuleBodyRenderState): string => {
      const node = state.source;
      const runtimeUpdate: AtRuleBodyRuntimeState = {};
      if (state.evaluatedPrelude) {
        runtimeUpdate.evaluatedPrelude = state.evaluatedPrelude;
      }
      if (state.evaluatedBody) {
        runtimeUpdate.evaluatedBody = state.evaluatedBody;
      }
      if (state.output) {
        runtimeUpdate.output = state.output;
      }
      return Object.keys(runtimeUpdate).length > 0
        ? runAtRuleBodyRuntimeState(node, runtimeUpdate, () => renderEvaluatedAtRule(node))
        : renderEvaluatedAtRule(node);
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
        if (isAtRuleBodyRenderState(node)) {
          return renderBodyState(node);
        }
        if (isAtRuleLeafState(node)) {
          return node.source.renderLeafValue(node.value, context, bufferOrOptions, options);
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
    const prelude = atRuleBodyRuntimeState.get(node)?.evaluatedPrelude ?? node.value.prelude;
    if (atRuleName === '@layer' && prelude) {
      const preludeStr = String(prelude.valueOf?.() ?? prelude.toTrimmedString?.() ?? prelude.toString?.() ?? '');
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
    return registration;
  }

  private _prepareNestableBodyForEval(
    node: AtRule,
    rules: Rules,
    context: Context,
    restoreBodyEvalContext: () => void
  ): MaybePromise<AtRuleBodyEvalPrepState> {
    if (!node.isNestable()) {
      return {
        bodyToEval: rules,
        pushedExtendRoot: false
      };
    }
    const parentExtendRoot = context.extendRoots.getCurrentExtendRoot();
    let preparedRules: MaybePromise<Node>;
    try {
      preparedRules = rules.prepareRegistration(context);
    } catch (error) {
      restoreBodyEvalContext();
      throw error;
    }
    const finish = (resolved: Node): AtRuleBodyEvalPrepState => {
      if (!(resolved instanceof Rules)) {
        restoreBodyEvalContext();
        throw new TypeError('Expected at-rule body registration prep to return Rules');
      }
      context.extendRoots.pushExtendRoot(resolved);
      return {
        bodyToEval: resolved,
        parentExtendRoot,
        pushedExtendRoot: true
      };
    };
    return isThenable(preparedRules)
      ? preparedRules.then(finish, (error) => {
          restoreBodyEvalContext();
          throw error;
        })
      : finish(preparedRules);
  }

  /** Render the opening of this at-rule (name and prelude) */
  getHeaderString(options: FinalPrintOptions, withoutComments?: boolean): string {
    let { name } = this.value;
    let prelude = atRuleBodyRuntimeState.get(this)?.evaluatedPrelude ?? this.value.prelude;
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
    return this.evalBodyNode(context, createAtRuleBodyEvalContextState(this, context));
  }

  private evalBodyNode(
    context: Context,
    bodyEvalContextState: AtRuleBodyEvalContextState
  ): MaybePromise<AtRule | Nil> {
    let node = this as AtRule;
    // @plugin is handled by the Less compatibility plugin during preparation.
    // If we reach eval and it's still visible, no plugin processed it.
    const atName = String(node.value?.name?.valueOf?.() ?? '');
    if (atName === '@plugin' && node.visible) {
      throw new Error('@plugin is only supported when using the Less compatibility plugin (@jesscss/plugin-less-compat).');
    }

    // Store frames snapshot for hoisting serialization
    if (context.opts.collapseNesting || node.hoistToRoot) {
      const frames = [...context.frames];
      if (bodyEvalContextState.writeOutputStateToNode) {
        node.frames = frames;
      }
      setAtRuleBodyEvalOutput(node, {
        ...bodyEvalContextState.frameState.output,
        frames
      });
    } else if (bodyEvalContextState.frameState.output) {
      setAtRuleBodyEvalOutput(node, bodyEvalContextState.frameState.output);
    }

    return pipe(
      () => {
        // Evaluate prelude in the correct scope (mixin params, vars, etc.).
        if (atRuleBodyRuntimeState.get(node)?.evaluatedPrelude) {
          return;
        }
        let { prelude } = node.value;
        if (prelude) {
          // Evaluate the prelude in the outer (enclosing) Rules scope, not the nested @media Rules scope.
          // This matches Less behavior for mixin parameters referenced from nested @media preludes.
          const out = this.evalPreludeValue(prelude, context);
          if (isThenable(out)) {
            return Promise.resolve(out).then(
              (n) => {
                setAtRuleBodyEvalPrelude(bodyEvalContextState, n);
                return undefined;
              }
            );
          }
          setAtRuleBodyEvalPrelude(bodyEvalContextState, out);
        }
      },
      () => {
        let { rules } = node.value;
        if (rules) {
          if (context.opts.collapseNesting && node.isNestable()) {
            if (bodyEvalContextState.writeOutputStateToNode) {
              node.hoistToRoot = true;
            }
            setAtRuleBodyEvalOutput(node, { hoistToRoot: true });
          }
          let restoreRulesetFrames = () => undefined;
          const restoreBodyEvalContext = () => {
            restoreAtRuleBodyEvalContextState(bodyEvalContextState, context);
          };
          // Push to frames before evaluating rules so we can use context.frames to find parent layers
          // This allows nested layers to find their parent layer names
          // NOTE: We do NOT pop here - the frame must remain accessible during rules evaluation
          // The frame will be popped at the end of evalNode
          context.frames.push(node);

          // Extract and store layer name AFTER pushing to frames but BEFORE evaluating rules
          // This ensures parent layers are already on the stack when we look for them
          this._extractAndStoreLayerName(node, context);

          const finishPreparedBody = (prepState: AtRuleBodyEvalPrepState): MaybePromise<AtRule> => {
            const { bodyToEval, parentExtendRoot, pushedExtendRoot } = prepState;
            const onlyRuleSetChild = isNode(bodyToEval.value[0], N.Ruleset);
            restoreRulesetFrames = activateAtRuleBodyEvalContextState(bodyEvalContextState, context);
            let evalOut: MaybePromise<Rules>;
            try {
              evalOut = bodyToEval.eval(context);
            } catch (error) {
              restoreBodyEvalContext();
              throw error;
            }
            const finishEval = (r: Rules): AtRule => {
              restoreRulesetFrames();
              const finalRules = onlyRuleSetChild && isNode(r.value[0], N.Rules) ? r.value[0] : r;
              storeAtRuleBodyEvalRules(bodyEvalContextState, finalRules);
              if (pushedExtendRoot && node.isNestable()) {
                this._registerEvaluatedNestableBody(node, context, {
                  bodyToEval,
                  finalRules,
                  parentExtendRoot
                });
              }
              return node;
            };
            if (isThenable(evalOut)) {
              return (evalOut as Promise<Rules>).then(finishEval, (error) => {
                restoreBodyEvalContext();
                throw error;
              });
            }
            return finishEval(evalOut as Rules);
          };

          const preparedBody = this._prepareNestableBodyForEval(node, rules, context, restoreBodyEvalContext);
          if (isThenable(preparedBody)) {
            return preparedBody.then(finishPreparedBody, (error) => {
              restoreBodyEvalContext();
              throw error;
            });
          }
          return finishPreparedBody(preparedBody);
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
      () => this.evalBodyResult(context),
      result => this.resolveBodyResult(result)
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
