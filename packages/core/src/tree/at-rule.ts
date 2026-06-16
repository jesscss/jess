import { Node, defineType, F_STATIC, F_VISIBLE, type NodeOptions } from './node.js';
import { Ruleset } from './ruleset.js';
import { Any } from './any.js';
import { Rules } from './rules.js';
import type { Context } from '../context.js';
import { type FinalPrintOptions, type PrintOptions, getPrintOptions, OutputWriter, prepareRenderPrintState } from './util/print.js';
import { isThenable, type MaybePromise } from '@jesscss/awaitable-pipe';
import { isNode } from './util/is-node.js';
import { N } from './node-type.js';
import { indent, normalizeIndent, serializeRulesContainer } from './util/serialize-helper.js';
import {
  isRenderBuffer,
  prepareBufferPrintState,
  writePreparedRenderText,
  writeRenderText,
  type RenderBuffer
} from './util/render-buffer.js';
import { Interpolated } from './interpolated.js';
import { Nil } from './nil.js';
import { consumeTrivia, createTriviaMap, emitCommentTriviaAfterNode, emitTriviaTokens } from './util/trivia.js';
import { canReuseLeaf, copyWithReusableLeaves, copyWithReusableLeavesPreservingComments, reuseLeaf } from './util/cloning.js';
import { withRulesContext } from './util/context.js';
import { canRenderStaticRulesDirectly } from './util/static-rules.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

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

export type AtRuleBodyOutputState = {
  hoistToRoot?: boolean;
  frames?: AtRule['frames'];
};

type AtRuleBodyEvalRecord = {
  source: AtRule;
  evalFrame: AtRule;
  resultNode?: AtRule | Nil;
  bodyRules?: Rules;
  renderSourceBody?: boolean;
  clearRulesetFrames: boolean;
  restoreRulesetFrames: () => void;
  registration?: AtRuleBodyRegistrationState;
  evaluatedPrelude?: Node;
  evaluatedBody?: Rules;
  output?: AtRuleBodyOutputState;
  visible?: boolean;
  layerName?: string;
  frameCount: number;
  extendRootStackLength: number;
  writeEvaluatedPrelude: boolean;
  writeVisibility: boolean;
};

type AtRuleBodyRegistrationState = {
  bodyToEval: Rules;
  finalRules: Rules;
  pushedExtendRoot: boolean;
  parentExtendRoot?: Rules;
};

type AtRuleLeafState = {
  kind: 'leaf-render';
  source: AtRule;
  value: AtRuleValue;
};

const activeAtRuleBodyEvalRecords = new WeakMap<Context, AtRuleBodyEvalRecord[]>();

function pushAtRuleBodyEvalRecord(
  context: Context,
  record: AtRuleBodyEvalRecord
): void {
  let stack = activeAtRuleBodyEvalRecords.get(context);
  if (!stack) {
    stack = [];
    activeAtRuleBodyEvalRecords.set(context, stack);
  }
  stack.push(record);
}

function popAtRuleBodyEvalRecord(
  context: Context,
  record: AtRuleBodyEvalRecord
): void {
  const stack = activeAtRuleBodyEvalRecords.get(context);
  if (!stack) {
    return;
  }
  const index = stack.lastIndexOf(record);
  if (index >= 0) {
    stack.splice(index, 1);
  }
  if (stack.length === 0) {
    activeAtRuleBodyEvalRecords.delete(context);
  }
}

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

function createAtRuleBodyEvalRecordState(
  context: Context,
  options: {
    evaluatedPrelude?: Node;
    output?: AtRuleBodyOutputState;
    writeEvaluatedPrelude?: boolean;
    writeVisibility?: boolean;
  } = {}
): Pick<
  AtRuleBodyEvalRecord,
  | 'evaluatedPrelude'
  | 'output'
  | 'frameCount'
  | 'extendRootStackLength'
  | 'writeEvaluatedPrelude'
  | 'writeVisibility'
> {
  return {
    evaluatedPrelude: options.evaluatedPrelude,
    output: options.output,
    frameCount: context.frames.length,
    extendRootStackLength: context.extendRoots.extendRootStack.length,
    writeEvaluatedPrelude: options.writeEvaluatedPrelude ?? true,
    writeVisibility: options.writeVisibility ?? true
  };
}

function runAtRuleBodyRulesEval<T>(
  record: AtRuleBodyEvalRecord,
  context: Context,
  work: () => MaybePromise<T>
): MaybePromise<T> {
  const restoreRulesetFrames = clearRulesetFramesForAtRuleBody(context, record.clearRulesetFrames);
  record.restoreRulesetFrames = restoreRulesetFrames;
  try {
    const out = work();
    if (isThenable(out)) {
      return out.then(
        (value) => {
          restoreRulesetFrames();
          return value;
        },
        (error) => {
          restoreRulesetFrames();
          throw error;
        }
      );
    }
    restoreRulesetFrames();
    return out;
  } catch (error) {
    restoreRulesetFrames();
    throw error;
  }
}

function setAtRuleBodyEvalOutput(
  record: AtRuleBodyEvalRecord,
  output: AtRuleBodyOutputState
): void {
  record.output = {
    ...record.output,
    ...output
  };
}

function setAtRuleBodyEvalPrelude(
  record: AtRuleBodyEvalRecord,
  prelude: Node
): void {
  record.evaluatedPrelude = prelude;
  if (record.writeEvaluatedPrelude) {
    record.evalFrame.value.prelude = prelude;
  }
}

function storeAtRuleBodyEvalRecordRules(
  record: AtRuleBodyEvalRecord,
  finalRules: Rules
): void {
  record.evaluatedBody = finalRules;
}

function storeAtRuleBodyEvalRecordVisibility(
  record: AtRuleBodyEvalRecord,
  visible: boolean
): void {
  record.visible = visible;
  if (!visible && record.writeVisibility) {
    record.evalFrame.removeFlag(F_VISIBLE);
  }
}

function storeAtRuleBodyRecordRegistration(
  record: AtRuleBodyEvalRecord,
  registration: AtRuleBodyRegistrationState
): AtRuleBodyRegistrationState {
  record.registration = registration;
  return registration;
}

function createAtRuleEvalResultNode(
  source: AtRule,
  record: AtRuleBodyEvalRecord
): AtRule {
  const ownsEvaluatedBody = Boolean(
    record.evaluatedBody
    && record.evaluatedBody !== source.value.rules
  );
  const ownsOutput = Boolean(
    (record.output?.hoistToRoot !== undefined && record.output.hoistToRoot !== source.hoistToRoot)
    || (record.output?.frames !== undefined && record.output.frames !== source.frames)
  );
  if (!ownsEvaluatedBody && !ownsOutput) {
    return source;
  }
  return applyAtRuleBodyPublicResultState(
    source.deriveAtRule(source.value),
    record,
    ownsEvaluatedBody || ownsOutput ? record.evaluatedBody : undefined
  );
}

function createAtRuleBodyRecordRegistration(
  record: AtRuleBodyEvalRecord,
  bodyToEval: Rules,
  options: {
    parentExtendRoot?: Rules;
    pushedExtendRoot: boolean;
  }
): AtRuleBodyRegistrationState {
  const { parentExtendRoot, pushedExtendRoot } = options;
  return storeAtRuleBodyRecordRegistration(record, {
    bodyToEval,
    finalRules: bodyToEval,
    pushedExtendRoot,
    ...(parentExtendRoot !== undefined && { parentExtendRoot })
  });
}

function storeAtRuleBodyRecordLayerName(
  record: AtRuleBodyEvalRecord,
  layerName: string | undefined
): void {
  record.layerName = layerName;
}

function hasCommentChild(value: unknown): boolean {
  if (isNode(value, N.Comment)) {
    return true;
  }
  if (value instanceof Node) {
    return hasCommentChild(value.value);
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      if (hasCommentChild(value[i])) {
        return true;
      }
    }
    return false;
  }
  if (isRecord(value)) {
    for (const key in value) {
      if (hasCommentChild(value[key])) {
        return true;
      }
    }
  }
  return false;
}

function isAtRuleLeafState(value: unknown): value is AtRuleLeafState {
  return Boolean(value && typeof value === 'object' && 'kind' in value && value.kind === 'leaf-render');
}

function isAtRuleBodyEvalRecordResult(value: unknown): value is AtRuleBodyEvalRecord {
  return Boolean(
    value
    && typeof value === 'object'
    && 'source' in value
    && 'evalFrame' in value
    && 'resultNode' in value
  );
}

function storeAtRuleBodyEvalRecordResult(
  record: AtRuleBodyEvalRecord,
  node: AtRule | Nil
): AtRuleBodyEvalRecord {
  record.resultNode = node;
  return record;
}

function applyAtRuleBodyPublicResultState(
  node: AtRule,
  record: AtRuleBodyEvalRecord,
  evaluatedBody: Rules | undefined = record.evaluatedBody
): AtRule {
  if (record.evaluatedPrelude) {
    node.value.prelude = record.evaluatedPrelude;
  }
  if (evaluatedBody && evaluatedBody !== node.value.rules) {
    node.adopt(evaluatedBody);
    node.value.rules = evaluatedBody;
  }
  if (record.visible === false) {
    node.removeFlag(F_VISIBLE);
  }
  if (record.output) {
    if (record.output.hoistToRoot !== undefined) {
      node.hoistToRoot = record.output.hoistToRoot;
    }
    if (record.output.frames !== undefined) {
      node.frames = record.output.frames;
    }
  }
  return node;
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
    const owned = canReuseLeaf(rules) ? reuseLeaf(rules) : copyWithReusableLeavesPreservingComments(rules);
    if (!(owned instanceof Rules)) {
      throw new TypeError('Expected at-rule rules copy');
    }
    return owned;
  }

  private applyDerivedMetadata(node: AtRule): AtRule {
    node.hoistToRoot = this.hoistToRoot;
    node.frames = this.frames ? [...this.frames] : undefined;
    return node;
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
      this.sourceRoot?._treeContext
    ).inherit(this);
    return this.applyDerivedMetadata(node);
  }

  /** Used for equality comparison with other at-rules */
  override valueOf() {
    return (this._valueOf ??= (this.value.name.valueOf() + (this.value.prelude ? ' ' + this.value.prelude.valueOf() : '')));
  }

  /**
   * Means: can bubble ruleset parents to children.
   */
  isNestable() {
    const atRuleName = this.value.name.valueOf();
    for (let i = 0; i < NESTABLE_AT_RULES.length; i++) {
      if (NESTABLE_AT_RULES[i] === atRuleName) {
        return true;
      }
    }
    return false;
  }

  /**
   * For legacy collapseNesting, will push ruleset to root silently.
   */
  isRootOnly() {
    const atRuleName = this.value.name.valueOf();
    for (let i = 0; i < ROOT_ONLY_AT_RULES.length; i++) {
      if (ROOT_ONLY_AT_RULES[i] === atRuleName) {
        return true;
      }
    }
    return false;
  }

  isHoisted(opts: { collapseNesting?: boolean }) {
    return this.getRenderFrames() !== undefined && this.isNestable()
      ? true
      : (this.hoistToRoot ?? Boolean(opts.collapseNesting && this.isNestable()));
  }

  getRenderFrames(): AtRule['frames'] {
    return this.frames;
  }

  override toTrimmedString(options?: PrintOptions): string {
    return serializeRulesContainer(this, getPrintOptions(options));
  }

  /** @internal */
  override writeSyntax(options: FinalPrintOptions): void {
    const { name, prelude, rules } = this.value;
    const w = options.writer;
    name.writeSyntax(options);
    if (prelude) {
      w.add(' ');
      prelude.writeSyntax(options);
    }
    if (rules) {
      w.add(' ');
      rules.writeBracedSyntax(options);
    } else {
      w.add(';');
    }
  }

  getRenderRules(): Rules | undefined {
    return this.value.rules;
  }

  private evalForRender(context: Context): MaybePromise<Node | AtRuleLeafState | AtRuleBodyEvalRecord> {
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
      const value = this.evalLeafValue(context);
      return isThenable(value)
        ? value.then(resolved => this.createLeafRenderState(resolved))
        : this.createLeafRenderState(value);
    }
    // Direct render on an unevaluated AtRule is a compatibility/debug API.
    // Public compiler render enters through an evaluated root Rules container.
    return this.evalBodyResult(context, {
      writeEvaluatedPrelude: false,
      writeVisibility: false
    });
  }

  private evalBodyResult(
    context: Context,
    options: {
      writeEvaluatedPrelude?: boolean;
      writeVisibility?: boolean;
    } = {}
  ): MaybePromise<AtRuleBodyEvalRecord> {
    const finishPrelude = (evaluatedPrelude: Node | undefined): MaybePromise<AtRuleBodyEvalRecord> => {
      const record = this.createBodyEvalRecord(context, evaluatedPrelude, options);
      const evaluated = this.evalBodyNode(context, record);
      const finish = (node: Node): AtRuleBodyEvalRecord => {
        if (!(node instanceof AtRule) && !(node instanceof Nil)) {
          throw new TypeError('Expected at-rule body eval to return AtRule or Nil');
        }
        return storeAtRuleBodyEvalRecordResult(record, node);
      };
      return isThenable(evaluated)
        ? evaluated.then(finish)
        : finish(evaluated);
    };
    const evaluatedPrelude = this.evalBodyPreludeState(context);
    return isThenable(evaluatedPrelude)
      ? evaluatedPrelude.then(finishPrelude)
      : finishPrelude(evaluatedPrelude);
  }

  private createBodyEvalRecord(
    context: Context,
    evaluatedPrelude: Node | undefined,
    options: {
      writeEvaluatedPrelude?: boolean;
      writeVisibility?: boolean;
    }
  ): AtRuleBodyEvalRecord {
    const evalFrame = this;
    const sourceRules = this.value.rules;
    let hasRulesetFrame = false;
    for (let i = 0; i < context.frames.length; i++) {
      if (isNode(context.frames[i], N.Ruleset)) {
        hasRulesetFrame = true;
        break;
      }
    }
    const hasHoistedRulesetParent = context.bubbleRootAtRules
      && this.isRootOnly()
      && hasRulesetFrame;
    const renderSourceBody = Boolean(
      sourceRules
      && canRenderStaticRulesDirectly(sourceRules)
      && !context.opts.collapseNesting
    );
    return {
      source: this,
      evalFrame,
      ...(renderSourceBody ? { renderSourceBody } : undefined),
      ...(sourceRules && !renderSourceBody ? { bodyRules: this.ownRules(sourceRules) } : undefined),
      clearRulesetFrames: hasHoistedRulesetParent,
      restoreRulesetFrames: () => undefined,
      ...createAtRuleBodyEvalRecordState(context, {
        evaluatedPrelude,
        output: hasHoistedRulesetParent ? { hoistToRoot: true } : undefined,
        writeEvaluatedPrelude: options.writeEvaluatedPrelude,
        writeVisibility: options.writeVisibility
      })
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
    const finishName = (name: Node): MaybePromise<AtRuleValue> => {
      if (!(name instanceof Any) && !(name instanceof Interpolated)) {
        throw new TypeError('Expected at-rule name to resolve to Any or Interpolated');
      }
      const { prelude } = this.value;
      if (!prelude) {
        return { name };
      }
      const resolvedPrelude = this.evalPreludeValue(prelude, context);
      if (isThenable(resolvedPrelude)) {
        return resolvedPrelude.then(resolved => ({ name, prelude: resolved }));
      }
      return {
        name,
        prelude: resolvedPrelude as Node
      };
    };
    const name = this.value.name;
    const evaluatedName = name instanceof Interpolated ? name.eval(context) : name;
    return isThenable(evaluatedName)
      ? evaluatedName.then(finishName)
      : finishName(evaluatedName);
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
    const nameOut = this.renderLeafNodeToString(value.name, printOptions);
    const preludeOut = value.prelude ? this.renderLeafNodeToString(value.prelude, printOptions) : '';
    const rendered = preludeOut.trim()
      ? `${nameOut}${/\s$/.test(nameOut) || /^\s/.test(preludeOut) ? '' : ' '}${preludeOut.replace(/^\s+/, '')};`
      : `${nameOut};`;
    return isRenderBuffer(bufferOrOptions)
      ? writeRenderText(bufferOrOptions, rendered)
      : rendered;
  }

  private renderLeafNodeToString(node: Node, printOptions: FinalPrintOptions): string {
    if (!printOptions.trivia && node instanceof Any) {
      return node.value;
    }
    const writer = new OutputWriter(printOptions.sourceMap === true);
    const savedWriter = printOptions.writer;
    try {
      printOptions.writer = writer;
      node.writeSyntax(printOptions);
      return writer.toString();
    } finally {
      printOptions.writer = savedWriter;
    }
  }

  private resolveLeafValue(value: AtRuleValue): AtRule {
    const node = new AtRule(
      {
        name: value.name === this.value.name ? this.ownName(value.name) : value.name,
        prelude: value.prelude && value.prelude === this.value.prelude ? this.ownNode(value.prelude) : value.prelude
      },
      this._options ? { ...this._options } : undefined,
      this.location.length ? this.location : undefined,
      this.sourceRoot?._treeContext
    ).inherit(this);
    return this.applyDerivedMetadata(node);
  }

  private resolveBodyResult(record: AtRuleBodyEvalRecord): AtRule {
    return applyAtRuleBodyPublicResultState(
      this.deriveAtRule(this.value),
      record
    );
  }

  private renderEvaluatedAtRule(
    node: AtRule,
    context: Context,
    bufferOrOptions?: RenderBuffer | PrintOptions,
    options?: PrintOptions,
    evaluatedPrelude?: Node,
    evaluatedBody?: Rules,
    runtimeHoist?: boolean,
    runtimeFrames?: (Ruleset | AtRule)[]
  ): string {
    const buffer = isRenderBuffer(bufferOrOptions) ? bufferOrOptions : undefined;
    const printState = buffer
      ? prepareBufferPrintState(context, options, buffer)
      : prepareRenderPrintState(context, bufferOrOptions);
    const mark = buffer ? printState.writer.mark() : 0;
    const priorHeaderNode = printState.atRuleHeaderNode;
    const priorHeaderPrelude = printState.atRuleHeaderPrelude;
    const priorBodyNode = printState.atRuleBodyNode;
    const priorBodyOverride = printState.atRuleBodyOverride;
    const priorHoistNode = printState.atRuleHoistNode;
    const priorHoistOverride = printState.atRuleHoistOverride;
    const priorFrameNode = printState.atRuleFrameNode;
    const priorFrameOverride = printState.atRuleFrameOverride;
    if (evaluatedPrelude) {
      printState.atRuleHeaderNode = node;
      printState.atRuleHeaderPrelude = evaluatedPrelude;
    }
    if (evaluatedBody !== undefined) {
      printState.atRuleBodyNode = node;
      printState.atRuleBodyOverride = evaluatedBody;
    }
    if (runtimeHoist !== undefined) {
      printState.atRuleHoistNode = node;
      printState.atRuleHoistOverride = runtimeHoist;
    }
    if (runtimeFrames !== undefined) {
      printState.atRuleFrameNode = node;
      printState.atRuleFrameOverride = runtimeFrames;
    }
    try {
      const rendered = serializeRulesContainer(node, printState);
      return buffer
        ? writePreparedRenderText(buffer, printState, mark, rendered)
        : rendered;
    } finally {
      printState.atRuleHeaderNode = priorHeaderNode;
      printState.atRuleHeaderPrelude = priorHeaderPrelude;
      printState.atRuleBodyNode = priorBodyNode;
      printState.atRuleBodyOverride = priorBodyOverride;
      printState.atRuleHoistNode = priorHoistNode;
      printState.atRuleHoistOverride = priorHoistOverride;
      printState.atRuleFrameNode = priorFrameNode;
      printState.atRuleFrameOverride = priorFrameOverride;
    }
  }

  private renderBodyResult(
    record: AtRuleBodyEvalRecord,
    context: Context,
    bufferOrOptions?: RenderBuffer | PrintOptions,
    options?: PrintOptions
  ): string {
    const resultNode = record.resultNode;
    if (!(resultNode instanceof AtRule) && !(resultNode instanceof Nil)) {
      throw new TypeError('Expected at-rule body eval record to carry a result node');
    }
    const evaluatedBody = resultNode instanceof Nil
      ? undefined
      : (record.evaluatedBody ?? resultNode.value.rules);
    const runtimeHoist = record.output?.hoistToRoot !== this.hoistToRoot
      ? record.output?.hoistToRoot
      : undefined;
    const runtimeFrames = record.output?.frames !== this.frames
      ? record.output?.frames
      : undefined;
    return this.renderEvaluatedAtRule(
      this,
      context,
      bufferOrOptions,
      options,
      record.evaluatedPrelude,
      evaluatedBody !== this.value.rules ? evaluatedBody : undefined,
      runtimeHoist,
      runtimeFrames
    );
  }

  private renderEvaluatedForRender(
    node: Node | AtRuleLeafState | AtRuleBodyEvalRecord,
    context: Context,
    bufferOrOptions?: RenderBuffer | PrintOptions,
    options?: PrintOptions
  ): string | MaybePromise<string> {
    if (node instanceof Nil) {
      return '';
    }
    if (node instanceof AtRule) {
      return this.renderEvaluatedAtRule(
        node,
        context,
        bufferOrOptions,
        options,
        undefined,
        undefined,
        undefined,
        node === this ? node.getRenderFrames() : undefined
      );
    }
    if (isAtRuleBodyEvalRecordResult(node)) {
      return this.renderBodyResult(node, context, bufferOrOptions, options);
    }
    if (isAtRuleLeafState(node)) {
      return node.source.renderLeafValue(node.value, context, bufferOrOptions, options);
    }
    return isRenderBuffer(bufferOrOptions)
      ? node.render(context, bufferOrOptions, options)
      : node.render(context, bufferOrOptions);
  }

  override render(context: Context, buffer: RenderBuffer, options?: PrintOptions): MaybePromise<string>;
  override render(context: Context, options?: PrintOptions): string;
  override render(context: Context, bufferOrOptions?: RenderBuffer | PrintOptions, options?: PrintOptions): string | MaybePromise<string> {
    const node = this.evalForRender(context);
    return isThenable(node)
      ? node.then(resolved => this.renderEvaluatedForRender(resolved, context, bufferOrOptions, options))
      : this.renderEvaluatedForRender(node, context, bufferOrOptions, options);
  }

  /**
   * Prepare name identity and body registration.
   * Prelude evaluation stays in evalNode so live-scope lookups stay correct.
   */
  override prepareRegistration(context: Context): MaybePromise<AtRule> {
    if (!this.registrationPrepared) {
      const prepared = this._prepareAtRuleNameIdentity(context);
      if (isThenable(prepared)) {
        return prepared.then(node => this._prepareAtRuleRegistration(node, context, this));
      }
      return this._prepareAtRuleRegistration(prepared, context, this);
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
      return maybeKey.then((key) => {
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

  private _prepareAtRuleRegistration(node: AtRule, context: Context, original: AtRule): MaybePromise<AtRule> {
    const { rules } = node.value;
    // Defer prelude evaluation to evalNode so variable lookups happen in the correct
    // live scope (e.g. mixin parameters referenced from nested @media preludes).
    return this._prepareAtRuleBodyRegistration(node, context, original, rules);
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

  private _extractAndStoreLayerName(
    node: AtRule,
    context: Context,
    evaluatedPrelude?: Node
  ): string | undefined {
    const atRuleName = String(node.value.name.valueOf());
    const prelude = evaluatedPrelude ?? node.value.prelude;
    if (atRuleName === '@layer' && prelude) {
      const preludeStr = String(prelude.valueOf?.() ?? prelude.toTrimmedString?.() ?? prelude.toString?.() ?? '');
      if (preludeStr) {
        let parentLayerName: string | undefined;
        const activeRecords = activeAtRuleBodyEvalRecords.get(context);
        if (activeRecords) {
          for (let i = activeRecords.length - 1; i >= 0; i--) {
            const record = activeRecords[i]!;
            const frame = record.source;
            if (frame === node || String(frame.value.name.valueOf()) !== '@layer') {
              continue;
            }
            const children = frame.value.rules?.value;
            let frameContainsNode = false;
            if (children) {
              for (let childIndex = 0; childIndex < children.length; childIndex++) {
                const child = children[childIndex]!;
                if (
                  child === node
                  || child === node.sourceNode
                  || child.sourceNode === node
                  || child.sourceNode === node.sourceNode
                ) {
                  frameContainsNode = true;
                  break;
                }
              }
            }
            const recordLayerName = record.layerName;
            if (frameContainsNode && recordLayerName) {
              parentLayerName = recordLayerName;
              break;
            }
          }
        }
        const layerName = parentLayerName ? `${parentLayerName}.${preludeStr}` : preludeStr;
        return layerName;
      }
    }
    return undefined;
  }

  private _registerEvaluatedNestableBody(
    record: AtRuleBodyEvalRecord,
    context: Context,
    state: AtRuleBodyRegistrationState
  ): AtRuleBodyRegistrationState {
    context.extendRoots.popExtendRoot();
    const layerName = record.layerName;
    const parent = state.parentExtendRoot ?? context.root ?? undefined;
    context.extendRoots.registerRoot(state.bodyToEval, parent as Rules | undefined, { layerName });
    registerInnerExtendRootIfHoisted(state.bodyToEval, context, layerName);
    if (state.finalRules !== state.bodyToEval) {
      context.extendRoots.registerRoot(state.finalRules, state.bodyToEval, { layerName });
      registerInnerExtendRootIfHoisted(state.finalRules, context, layerName);
    }
    context.extendRoots.pushExtendRoot(state.bodyToEval);
    context.extendRoots.popExtendRoot();
    return state;
  }

  private _prepareBodyRegistrationForEval(
    record: AtRuleBodyEvalRecord,
    context: Context,
    restoreBodyEvalContext: () => void
  ): MaybePromise<AtRuleBodyRegistrationState> {
    const node = record.evalFrame;
    const rules = record.bodyRules ?? node.value.rules!;
    if (!node.isNestable()) {
      return createAtRuleBodyRecordRegistration(record, rules, {
        pushedExtendRoot: false
      });
    }
    const parentExtendRoot = context.extendRoots.getCurrentExtendRoot();
    let preparedRules: MaybePromise<Node>;
    try {
      preparedRules = rules.prepareRegistration(context);
    } catch (error) {
      restoreBodyEvalContext();
      throw error;
    }
    const finish = (resolved: Node): AtRuleBodyRegistrationState => {
      if (!(resolved instanceof Rules)) {
        restoreBodyEvalContext();
        throw new TypeError('Expected at-rule body registration prep to return Rules');
      }
      context.extendRoots.pushExtendRoot(resolved);
      return createAtRuleBodyRecordRegistration(record, resolved, {
        parentExtendRoot,
        pushedExtendRoot: true
      });
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
    let prelude = options.atRuleHeaderNode === this
      ? (options.atRuleHeaderPrelude ?? this.value.prelude)
      : this.value.prelude;
    const rules = options.atRuleBodyNode === this
      ? options.atRuleBodyOverride
      : this.getRenderRules();

    let idt = indent(options.depth);
    let out = idt;

    if (withoutComments && (hasCommentChild(name) || hasCommentChild(prelude))) {
      name = this.ownName(name);
      if (prelude) {
        prelude = this.ownNode(prelude);
      }
    }

    let savedTrivia = options.trivia;
    if (withoutComments) {
      options.trivia = createTriviaMap();
    }
    let nameOut: string;
    if (!withoutComments && !options.trivia && name instanceof Any) {
      nameOut = name.value;
      options.trivia = savedTrivia;
    } else {
      const writer = new OutputWriter(options.sourceMap === true);
      const savedWriter = options.writer;
      try {
        options.writer = writer;
        name.writeSyntax(options);
        nameOut = writer.toString();
      } finally {
        options.writer = savedWriter;
        options.trivia = savedTrivia;
      }
    }
    const nameEndsWithSpace = /\s$/.test(nameOut);
    if (prelude) {
      const preludeTrivia = withoutComments
        ? createTriviaMap()
        : options.trivia ?? prelude.sourceRoot?._treeContext?.opts?.trivia;
      const preludePrintOptions: FinalPrintOptions = options.context && preludeTrivia
        ? {
            ...options,
            context: undefined,
            trivia: preludeTrivia,
            emittedTrivia: options.emittedTrivia
          }
        : options;
      savedTrivia = preludePrintOptions.trivia;
      if (withoutComments) {
        preludePrintOptions.trivia = createTriviaMap();
      }
      let preludeOut: string;
      if (!withoutComments && !preludeTrivia && prelude instanceof Any) {
        preludeOut = prelude.value;
        preludePrintOptions.trivia = savedTrivia;
      } else {
        const writer = new OutputWriter(preludePrintOptions.sourceMap === true);
        const savedWriter = preludePrintOptions.writer;
        try {
          preludePrintOptions.writer = writer;
          emitTriviaTokens(
            consumeTrivia(preludeTrivia, prelude.location[0], 'before', preludePrintOptions),
            preludePrintOptions
          );
          prelude.writeSyntax(preludePrintOptions);
          preludeOut = writer.toString();
        } finally {
          preludePrintOptions.writer = savedWriter;
          preludePrintOptions.trivia = savedTrivia;
        }
      }
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
      let preludePost = '';
      if (!withoutComments && preludeTrivia) {
        const writer = new OutputWriter(options.sourceMap === true);
        const savedWriter = options.writer;
        try {
          options.writer = writer;
          emitCommentTriviaAfterNode(prelude, options);
          preludePost = writer.toString();
        } finally {
          options.writer = savedWriter;
        }
      }
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
    let hasRulesetFrame = false;
    for (let i = 0; i < context.frames.length; i++) {
      if (isNode(context.frames[i], N.Ruleset)) {
        hasRulesetFrame = true;
        break;
      }
    }
    const hasHoistedRulesetParent = context.bubbleRootAtRules
      && this.isRootOnly()
      && hasRulesetFrame;
    const record = {
      source: this,
      evalFrame: this,
      clearRulesetFrames: hasHoistedRulesetParent,
      restoreRulesetFrames: () => undefined,
      ...createAtRuleBodyEvalRecordState(context, {
        output: hasHoistedRulesetParent ? { hoistToRoot: true } : undefined
      })
    };
    const out = this.evalBodyNode(context, record);
    if (isThenable(out)) {
      return out.then((value) => {
        return value instanceof AtRule
          ? createAtRuleEvalResultNode(this, record)
          : value;
      });
    }
    return out instanceof AtRule
      ? createAtRuleEvalResultNode(this, record)
      : out;
  }

  private evalBodyNode(
    context: Context,
    bodyEvalRecord: AtRuleBodyEvalRecord
  ): MaybePromise<AtRule | Nil> {
    const source = bodyEvalRecord.source;
    let node = bodyEvalRecord.evalFrame;
    // @plugin is handled by the Less compatibility plugin during preparation.
    // If we reach eval and it's still visible, no plugin processed it.
    const atName = String(node.value?.name?.valueOf?.() ?? '');
    if (atName === '@plugin' && node.visible) {
      throw new Error('@plugin is only supported when using the Less compatibility plugin (@jesscss/plugin-less-compat).');
    }

    // Store frames snapshot for hoisting serialization
    if (context.opts.collapseNesting || node.hoistToRoot) {
      const frames = [...context.frames];
      setAtRuleBodyEvalOutput(bodyEvalRecord, {
        frames
      });
    }

    const finishVisibility = (): AtRule => {
      let rules = bodyEvalRecord.evaluatedBody ?? bodyEvalRecord.bodyRules ?? node.getRenderRules();
      if (rules && !rules.hasVisibleRules()) {
        storeAtRuleBodyEvalRecordVisibility(bodyEvalRecord, false);
      }
      return node;
    };
    const finishBodyEval = (): MaybePromise<AtRule> => {
      let rules = bodyEvalRecord.bodyRules ?? node.value.rules;
      if (rules) {
        if (bodyEvalRecord.renderSourceBody) {
          return finishVisibility();
        }
        const out = source.runBodyEvalInvocation(context, bodyEvalRecord, node, (restoreBodyEvalContext) => {
          const finishPreparedBody = (registration: AtRuleBodyRegistrationState): MaybePromise<AtRule> => {
            const { bodyToEval } = registration;
            const onlyRuleSetChild = isNode(bodyToEval.value[0], N.Ruleset);
            const finishEval = (r: Rules): AtRule => {
              const finalRules = onlyRuleSetChild && isNode(r.value[0], N.Rules) ? r.value[0] : r;
              storeAtRuleBodyEvalRecordRules(bodyEvalRecord, finalRules);
              registration.finalRules = finalRules;
              if (registration.pushedExtendRoot && node.isNestable()) {
                source._registerEvaluatedNestableBody(bodyEvalRecord, context, registration);
              }
              return node;
            };
            return runAtRuleBodyRulesEval(bodyEvalRecord, context, () => {
              const evalOut = bodyToEval.eval(context);
              return isThenable(evalOut)
                ? evalOut.then(finishEval)
                : finishEval(evalOut);
            });
          };

          const registration = source._prepareBodyRegistrationForEval(
            bodyEvalRecord,
            context,
            restoreBodyEvalContext
          );
          return isThenable(registration)
            ? registration.then(finishPreparedBody)
            : finishPreparedBody(registration);
        });
        return isThenable(out)
          ? out.then(finishVisibility)
          : finishVisibility();
      }
      return finishVisibility();
    };
    // Evaluate prelude in the correct scope (mixin params, vars, etc.).
    if (bodyEvalRecord.evaluatedPrelude) {
      return finishBodyEval();
    }
    let { prelude } = node.value;
    if (prelude) {
      // Evaluate the prelude in the outer (enclosing) Rules scope, not the nested @media Rules scope.
      // This matches Less behavior for mixin parameters referenced from nested @media preludes.
      const out = source.evalPreludeValue(prelude, context);
      if (isThenable(out)) {
        return out.then((n) => {
          setAtRuleBodyEvalPrelude(bodyEvalRecord, n);
          return finishBodyEval();
        });
      }
      setAtRuleBodyEvalPrelude(bodyEvalRecord, out);
    }
    return finishBodyEval();
  }

  private runBodyEvalInvocation<T>(
    context: Context,
    bodyEvalRecord: AtRuleBodyEvalRecord,
    node: AtRule,
    run: (restoreBodyEvalContext: () => void) => MaybePromise<T>
  ): MaybePromise<T> {
    let restored = false;
    const restore = () => {
      if (restored) {
        return;
      }
      restored = true;
      popAtRuleBodyEvalRecord(context, bodyEvalRecord);
      context.frames.length = bodyEvalRecord.frameCount;
      bodyEvalRecord.restoreRulesetFrames();
      while (context.extendRoots.extendRootStack.length > bodyEvalRecord.extendRootStackLength) {
        context.extendRoots.popExtendRoot();
      }
    };
    pushAtRuleBodyEvalRecord(context, bodyEvalRecord);
    context.frames.push(node);
    storeAtRuleBodyRecordLayerName(
      bodyEvalRecord,
      bodyEvalRecord.source._extractAndStoreLayerName(
        node,
        context,
        bodyEvalRecord.evaluatedPrelude
      )
    );
    try {
      const out = run(restore);
      if (isThenable(out)) {
        return out.then(
          (value) => {
            restore();
            return value;
          },
          (error) => {
            restore();
            throw error;
          }
        );
      }
      restore();
      return out;
    } catch (error) {
      restore();
      throw error;
    }
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
      const value = this.evalLeafValue(context);
      return isThenable(value)
        ? value.then(resolved => this.resolveLeafValue(resolved))
        : this.resolveLeafValue(value);
    }
    const result = this.evalBodyResult(context, {
      writeEvaluatedPrelude: false,
      writeVisibility: false
    });
    return isThenable(result)
      ? result.then(resolved => this.resolveBodyResult(resolved))
      : this.resolveBodyResult(result);
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
