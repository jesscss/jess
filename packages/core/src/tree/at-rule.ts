import { Node, defineType, F_STATIC, F_VISIBLE, type LocationInfo, type NodeOptions } from './node.js';
import { Ruleset } from './ruleset.js';
import { Anonymous, Any, Keyword } from './any.js';
import { Rules } from './rules.js';
import type { Context } from '../context.js';
import { OutputWriter, type FinalPrintOptions, type PrintOptions, getPrintOptions, prepareRenderPrintState } from './util/print.js';
import { isThenable, type MaybePromise } from '@jesscss/awaitable-pipe';
import { isNode } from './util/is-node.js';
import { N } from './node-type.js';
import { indent, normalizeIndent, serializeRulesContainer } from './util/serialize-helper.js';
import { isRenderBuffer, prepareBufferPrintState, writeRenderText, type RenderBuffer } from './util/render-buffer.js';
import { Interpolated } from './interpolated.js';
import { Nil } from './nil.js';
import {
  createTriviaMap,
  emitCommentTriviaAfterNode,
  emitCommentTriviaBetweenNodes,
  emitNodeSourceSyntaxWithTrivia
} from './util/trivia.js';
import { canReuseLeaf, copyWithReusableLeaves, copyWithReusableLeavesPreservingComments, reuseLeaf } from './util/cloning.js';
import { withRulesContext } from './util/context.js';
import { canRenderStaticRuleArrayDirectly } from './util/static-rules.js';
import { registerRulesetWithRoot } from './util/extend-roots.js';

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
  if (wrapperRules.rules.length !== 1) {
    return;
  }
  const first = wrapperRules.rules[0];
  if (!isNode(first, N.Ruleset)) {
    return;
  }
  const innerRules = first.rules;
  if (!innerRules || !isNode(innerRules, N.Rules)) {
    return;
  }
  context.extendRoots.registerRoot(innerRules, wrapperRules, { layerName });
}

function registerEvaluatedRulesetsForRoot(root: Rules, rules: Rules): void {
  for (let i = 0; i < rules.rules.length; i++) {
    const child = rules.rules[i]!;
    if (!isNode(child, N.Ruleset)) {
      continue;
    }
    registerRulesetWithRoot(root, child);
    registerEvaluatedRulesetsForRoot(root, child);
  }
}

export type AtRulePrelude = string | Node;

export type AtRuleValue = {
  name: string | Any | Interpolated;
  /** The prelude */
  prelude?: AtRulePrelude;
  rules: Node[];
};

export type AtRuleParts = {
  name: AtRuleValue['name'];
  prelude?: AtRuleValue['prelude'];
  rules: Node[];
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

// AUDIT: Another huge pile of suspicious functions
function atRuleScalarTokenText(node: Node): string | undefined {
  if (
    node.constructor === Any
    || node.constructor === Anonymous
    || node.constructor === Keyword
  ) {
    return (node as Any).value;
  }
  return undefined;
}

function getAtRuleSourceIdentityText(node: string | Node | undefined): string {
  if (!node) {
    return '';
  }
  if (typeof node === 'string') {
    return node;
  }
  const scalarText = atRuleScalarTokenText(node);
  if (scalarText !== undefined) {
    return scalarText;
  }
  const writer = new OutputWriter(false);
  node.writeSyntax(getPrintOptions({ writer }));
  return writer.toString();
}

function normalizeAtRuleIdentityText(text: string): string {
  return trimAtRuleTrailingWhitespace(trimAtRuleLeadingWhitespace(text));
}

function renderAtRuleHeaderNodeSyntax(
  node: Node,
  printOptions: FinalPrintOptions,
  withoutComments?: boolean
): string {
  const scalarText = atRuleScalarTokenText(node);
  if (scalarText !== undefined) {
    return scalarText;
  }
  const savedTrivia = printOptions.trivia;
  if (withoutComments) {
    printOptions.trivia = createTriviaMap();
  }
  try {
    const writer = new OutputWriter(printOptions.compress);
    emitNodeSourceSyntaxWithTrivia(node, {
      ...printOptions,
      writer
    });
    return writer.toString();
  } finally {
    printOptions.trivia = savedTrivia;
  }
}

function renderAtRulePostPreludeTrivia(
  prelude: Node,
  printOptions: FinalPrintOptions
): string {
  const writer = new OutputWriter(printOptions.compress);
  emitCommentTriviaAfterNode(prelude, {
    ...printOptions,
    writer
  });
  return writer.toString();
}

function renderAtRuleBetweenNameAndPreludeTrivia(
  name: Node,
  prelude: Node,
  printOptions: FinalPrintOptions
): string {
  const writer = new OutputWriter(printOptions.compress);
  emitCommentTriviaBetweenNodes(name, prelude, {
    ...printOptions,
    writer
  });
  return writer.toString();
}

function buildComparableAtRuleHeader(
  nameOut: string,
  preludeOut: string | undefined
): string {
  if (!preludeOut || !hasNonAtRuleWhitespace(preludeOut)) {
    return trimAtRuleTrailingWhitespace(nameOut);
  }
  const nameEndsWithSpace = endsWithAtRuleWhitespace(nameOut);
  const preludeStartsWithSpace = startsWithAtRuleWhitespace(preludeOut);
  let out = nameOut;
  if (preludeStartsWithSpace) {
    out += trimAtRuleLeadingWhitespace(preludeOut, nameEndsWithSpace ? '' : ' ');
  } else {
    if (!nameEndsWithSpace) {
      out += ' ';
    }
    out += preludeOut;
  }
  return trimAtRuleTrailingWhitespace(out);
}

function isAtRuleWhitespace(code: number): boolean {
  return code === 32 || code === 9 || code === 10 || code === 13 || code === 12;
}

function hasNonAtRuleWhitespace(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    if (!isAtRuleWhitespace(text.charCodeAt(i))) {
      return true;
    }
  }
  return false;
}

function startsWithAtRuleWhitespace(text: string): boolean {
  return text.length > 0 && isAtRuleWhitespace(text.charCodeAt(0));
}

function endsWithAtRuleWhitespace(text: string): boolean {
  return text.length > 0 && isAtRuleWhitespace(text.charCodeAt(text.length - 1));
}

function trimAtRuleLeadingWhitespace(text: string, replacement = ''): string {
  let index = 0;
  while (index < text.length && isAtRuleWhitespace(text.charCodeAt(index))) {
    index++;
  }
  return index === 0 ? text : replacement + text.slice(index);
}

function trimAtRuleTrailingWhitespace(text: string): string {
  let end = text.length;
  while (end > 0 && isAtRuleWhitespace(text.charCodeAt(end - 1))) {
    end--;
  }
  return end === text.length ? text : text.slice(0, end);
}

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
    // Lift through at-rule wrappers to the enclosing Rules scope, but stop before
    // Mixin nodes: a Mixin's scope frame does not carry param live-slots — those
    // live in the shallow eval surface created by createCallableRulesSurface,
    // which IS the current cursor when we reach this point.
    if (isNode(parent, N.AtRule) && isNode(grandparent, N.Rules) && !isNode(grandparent, N.Mixin)) {
      cursor = grandparent;
      continue;
    }
    break;
  }
  return cursor;
}

// AUDIT: Jesuuuuuus christ what are all these new functions and why are they in this node file
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
      return (out as Promise<T>).then(
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
    record.evalFrame.adopt(prelude);
    record.evalFrame.prelude = prelude;
    record.evalFrame._valueOf = undefined;
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
  const ownsEvaluatedPrelude = Boolean(
    record.evaluatedPrelude
    && record.evaluatedPrelude !== source.prelude
  );
  const ownsEvaluatedBody = Boolean(
    record.evaluatedBody
    && record.evaluatedBody.rules !== source.rules
  );
  const ownsOutput = Boolean(
    (record.output?.hoistToRoot !== undefined && record.output.hoistToRoot !== source.hoistToRoot)
    || (record.output?.frames !== undefined && record.output.frames !== source.frames)
  );
  if (!ownsEvaluatedPrelude && !ownsEvaluatedBody && !ownsOutput) {
    return source;
  }
  return applyAtRuleBodyPublicResultState(
    source.withParts({
      name: source.name,
      ...(source.prelude !== undefined && { prelude: source.prelude }),
      rules: source.rules
    }),
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
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Node subclasses carry their value in `.value`
    return hasCommentChild((value as unknown as { value: unknown }).value);
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

function writeLeafAtRuleHeader(
  options: FinalPrintOptions,
  node: Pick<AtRule, 'name' | 'prelude'>
): boolean {
  if (options.trivia) {
    return false;
  }
  if (hasCommentChild(node.name) || hasCommentChild(node.prelude)) {
    return false;
  }
  const w = options.writer;
  const readNodeText = (n: string | Node): string => {
    if (typeof n === 'string') {
      return n;
    }
    const scalarText = atRuleScalarTokenText(n);
    return scalarText ?? renderAtRuleHeaderNodeSyntax(n, options);
  };
  const nameText = readNodeText(node.name);
  const prelude = node.prelude;
  const preludeText = prelude ? readNodeText(prelude) : '';
  const idt = indent(options.depth);
  if (idt) {
    w.add(idt);
  }
  w.add(nameText, node.name);
  if (preludeText && hasNonAtRuleWhitespace(preludeText)) {
    const nameEndsWithSpace = endsWithAtRuleWhitespace(nameText);
    const preludeStartsWithSpace = startsWithAtRuleWhitespace(preludeText);
    if (!(nameEndsWithSpace || preludeStartsWithSpace)) {
      w.add(' ');
    }
    w.add(trimAtRuleLeadingWhitespace(preludeText, nameEndsWithSpace ? '' : ' '), prelude!);
  }
  w.add(';');
  return true;
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

function isDirectRulesNode(node: Node | undefined): node is Rules {
  return node?.type === 'Rules';
}

function applyAtRuleBodyPublicResultState(
  node: AtRule,
  record: AtRuleBodyEvalRecord,
  evaluatedBody: Rules | undefined = record.evaluatedBody
): AtRule {
  if (record.evaluatedPrelude && record.evaluatedPrelude !== node.prelude) {
    node.adopt(record.evaluatedPrelude);
    node.prelude = record.evaluatedPrelude;
    node._valueOf = undefined;
  }
  if (evaluatedBody && evaluatedBody.rules !== node.rules) {
    (node as { rules: Node[] }).rules = evaluatedBody.rules;
    for (let i = 0; i < node.rules.length; i++) {
      node.adopt(node.rules[i]!);
    }
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

function hasVisibleRuleNodes(rules: readonly Node[]): boolean {
  for (let i = 0; i < rules.length; i++) {
    if (rules[i]!.visible) {
      return true;
    }
  }
  return false;
}

function attachAtRuleBodyOuterScope(rules: Rules, context: Context): Rules {
  const outerRules = context.rulesContext;
  if (outerRules && outerRules !== rules) {
    const outerFrame = outerRules.getScopeFrame();
    rules.getScopeFrame(outerFrame);
  }
  return rules;
}

function createAtRuleBodyEvalSurface(node: AtRule, context: Context): Rules {
  const surface = new Rules(node.ownRules(node.rules));
  surface.parent = node;
  surface.sourceNode = node;
  return attachAtRuleBodyOuterScope(surface, context);
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
 * A block-bearing at-rule like @media, @supports, or @font-face.
 */
export class AtRule extends Rules<AtRuleValue | AtRuleParts, AtRuleOptions> {
  static override childKeys = ['name', 'prelude', 'rules'] as const;
  override allowRoot = true;

  frames: (Ruleset | AtRule)[] | undefined;

  _valueOf: string | undefined;
  name: AtRuleParts['name'];
  prelude: AtRuleParts['prelude'];
  declare readonly rules: Node[];

  constructor(value: AtRuleValue | AtRuleParts, options?: AtRuleOptions, location?: LocationInfo, treeContext?: Context['treeContext']) {
    // Accept either a bare Node array or a Rules container node (unwrapped to its
    // child array) — factories pass a Rules node; the parser passes the array.
    const rulesValue = value.rules instanceof Rules ? value.rules.rules : value.rules;
    if (!Array.isArray(rulesValue)) {
      throw new TypeError('AtRule requires rules to be a Node array. Use AtRuleStatement for semicolon at-rules.');
    }
    super(rulesValue, options, location, treeContext);
    // Invariant 7: store, don't adopt. `parentChildren()` (factory) parents.
    this.name = value.name;
    this.prelude = value.prelude;
  }

  private materializeHeaderForSemantics(): { name: AtRuleValue['name']; prelude: AtRuleValue['prelude'] } {
    if (typeof this.name === 'string') {
      const name = new Any(this.name, { role: 'atkeyword' }, this.location.length ? this.location : undefined, this.sourceRoot?._treeContext)
        .inherit(this);
      this.adopt(name);
      this.name = name;
    }
    if (typeof this.prelude === 'string') {
      const prelude = new Any(this.prelude, undefined, this.location.length ? this.location : undefined, this.sourceRoot?._treeContext)
        .inherit(this);
      this.adopt(prelude);
      this.prelude = prelude;
    }
    this._valueOf = undefined;
    return { name: this.name, prelude: this.prelude };
  }

  private atRuleNameText(): string {
    return typeof this.name === 'string' ? this.name : this.name.valueOf();
  }

  private ownName(name: AtRuleValue['name']): AtRuleValue['name'] {
    if (typeof name === 'string') {
      return name;
    }
    const owned = canReuseLeaf(name) ? reuseLeaf(name) : copyWithReusableLeaves(name);
    if (!(owned instanceof Any) && !(owned instanceof Interpolated)) {
      throw new TypeError('Expected at-rule name copy');
    }
    return owned;
  }

  private ownNode<T extends string | Node>(node: T): T {
    if (typeof node === 'string') {
      return node;
    }
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    return (canReuseLeaf(node) ? reuseLeaf(node) : copyWithReusableLeaves(node)) as T;
  }

  ownRules(rules: Node[]): Node[] {
    const owned = new Array<Node>(rules.length);
    for (let i = 0; i < rules.length; i++) {
      const copied = copyWithReusableLeavesPreservingComments(rules[i]!);
      if (!(copied instanceof Node)) {
        throw new TypeError('Expected at-rule rule copy to remain a node');
      }
      owned[i] = copied;
    }
    return owned;
  }

  private applyDerivedMetadata(node: AtRule): AtRule {
    node.hoistToRoot = this.hoistToRoot;
    node.frames = this.frames ? [...this.frames] : undefined;
    return node;
  }

  withParts(parts: AtRuleParts, sourceParts: AtRuleParts = {
    name: this.name,
    ...(this.prelude !== undefined && { prelude: this.prelude }),
    rules: this.rules
  }): AtRule {
    const node = new AtRule(
      {
        name: parts.name === sourceParts.name ? this.ownName(parts.name) : parts.name,
        prelude: parts.prelude && parts.prelude === sourceParts.prelude ? this.ownNode(parts.prelude) : parts.prelude,
        rules: parts.rules && parts.rules === sourceParts.rules ? this.ownRules(parts.rules) : parts.rules
      },
      this._options ? { ...this._options } : undefined,
      this.location.length ? this.location : undefined,
      this.sourceRoot?._treeContext
    ).inherit(this);
    return this.applyDerivedMetadata(node);
  }

  override clone(cloneFn?: (n: Node) => Node): this {
    const clonePart = <T extends Node | string | undefined>(part: T): T => (
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- cloneFn preserves the concrete at-rule field type supplied by this at-rule part.
      cloneFn && part instanceof Node ? cloneFn(part) as T : part
    );
    const rules = cloneFn
      ? this.rules.map(rule => cloneFn(rule))
      : [...this.rules];
    const node = new AtRule(
      {
        name: clonePart(this.name),
        ...(this.prelude !== undefined && { prelude: clonePart(this.prelude) }),
        rules
      },
      this._options ? { ...this._options } : undefined,
      this.location.length ? this.location : undefined,
      this.sourceRoot?._treeContext
    ).inherit(this);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    return this.applyDerivedMetadata(node) as this;
  }

  /** Used for equality comparison with other at-rules */
  override valueOf() {
    return (this._valueOf ??= this.atRuleNameText() + (
      this.prelude
        ? ' ' + getAtRuleSourceIdentityText(this.prelude)
        : ''
    ));
  }

  /**
   * Means: can bubble ruleset parents to children.
   */
  isNestable() {
    const atRuleName = this.atRuleNameText();
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
    const atRuleName = this.atRuleNameText();
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
    const opts = getPrintOptions(options);
    const w = opts.writer!;
    const mark = w.mark();
    this.writeSyntax(opts);
    return w.getSince(mark);
  }

  override toString(options?: PrintOptions): string {
    if (!this.hasFlag(F_VISIBLE) && !this.fullRender) {
      return '';
    }
    const opts = getPrintOptions(options);
    const w = opts.writer!;
    const mark = w.mark();
    const trivia = opts.trivia ?? this.sourceRoot?._treeContext?.opts?.trivia;
    if (trivia && opts.trivia !== trivia) {
      opts.trivia = trivia;
    }
    this.toTrimmedString(opts);
    return w.getSince(mark);
  }

  override writeSyntax(options: FinalPrintOptions): void {
    if (!this.rules.length) {
      if (!writeLeafAtRuleHeader(options, this)) {
        options.writer.add(this.getHeaderString(options));
      }
      return;
    }
    serializeRulesContainer(this, options);
  }

  getRenderRules(): Node[] {
    return this.rules;
  }

  private _evalForAtRuleRender(context: Context): MaybePromise<Node | AtRuleBodyEvalRecord> {
    if (this.hasFlag(F_STATIC)) {
      return this;
    }
    if (this.registrationPrepared) {
      return this.eval(context);
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
    const sourceRules = this;
    let hasRulesetFrame = false;
    for (let i = 0; i < context.frames.length; i++) {
      if (isNode(context.frames[i], N.Ruleset)) {
        hasRulesetFrame = true;
        break;
      }
    }
    if (!hasRulesetFrame) {
      for (let i = 0; i < context.rulesetFrames.length; i++) {
        if (isNode(context.rulesetFrames[i], N.Ruleset)) {
          hasRulesetFrame = true;
          break;
        }
      }
    }
    const hasHoistedRulesetParent = context.bubbleRootAtRules
      && this.isRootOnly()
      && hasRulesetFrame;
    const renderSourceBody = Boolean(
      sourceRules
      && canRenderStaticRuleArrayDirectly(sourceRules.rules)
      && !context.opts.output?.collapseNesting
      && !hasHoistedRulesetParent
    );
    const bodyRules = renderSourceBody
      ? undefined
      : createAtRuleBodyEvalSurface(this, context);
    return {
      source: this,
      evalFrame,
      ...(renderSourceBody ? { renderSourceBody } : undefined),
      ...(bodyRules ? { bodyRules } : undefined),
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
    const { prelude } = this;
    if (!prelude) {
      return undefined;
    }
    if (typeof prelude === 'string') {
      return undefined;
    }
    return this.evalPreludeValue(prelude, context);
  }

  private evalPreludeValue(prelude: Node, context: Context): MaybePromise<Node> {
    return withRulesContext(
      context,
      liftedAtRulePreludeRulesContext(context.rulesContext),
      () => prelude.eval(context)
    );
  }

  private resolveBodyResult(record: AtRuleBodyEvalRecord): AtRule {
    return applyAtRuleBodyPublicResultState(
      this.withParts({
        name: this.name,
        ...(this.prelude !== undefined && { prelude: this.prelude }),
        rules: this.rules
      }),
      record
    );
  }

  private renderSerializedAtRule(
    node: AtRule,
    context: Context,
    bufferOrOptions?: RenderBuffer | PrintOptions,
    options?: PrintOptions,
    evaluatedPrelude?: Node,
    evaluatedBody?: Rules,
    runtimeHoist?: boolean,
    runtimeFrames?: (Ruleset | AtRule)[]
  ): string {
    const printState = isRenderBuffer(bufferOrOptions)
      ? prepareBufferPrintState(context, options)
      : prepareRenderPrintState(context, bufferOrOptions);
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
      return isRenderBuffer(bufferOrOptions)
        ? writeRenderText(bufferOrOptions, rendered)
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

  private renderBodyRecord(
    record: AtRuleBodyEvalRecord,
    context: Context,
    bufferOrOptions?: RenderBuffer | PrintOptions,
    options?: PrintOptions
  ): string {
    const resultNode = record.resultNode;
    const evaluatedBody = resultNode instanceof Nil
      ? undefined
      : record.evaluatedBody;
    const runtimeHoist = record.output?.hoistToRoot !== this.hoistToRoot
      ? record.output?.hoistToRoot
      : undefined;
    const runtimeFrames = record.output?.frames !== this.frames
      ? record.output?.frames
      : undefined;
    return this.renderSerializedAtRule(
      this,
      context,
      bufferOrOptions,
      options,
      record.evaluatedPrelude,
      evaluatedBody && evaluatedBody.rules !== this.rules ? evaluatedBody : undefined,
      runtimeHoist,
      runtimeFrames
    );
  }

  private renderEvaluatedValue(
    node: Node | AtRuleBodyEvalRecord,
    context: Context,
    bufferOrOptions?: RenderBuffer | PrintOptions,
    options?: PrintOptions
  ): string | MaybePromise<string> {
    if (node instanceof Nil) {
      return '';
    }
    if (node instanceof AtRule) {
      return this.renderSerializedAtRule(
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
      return this.renderBodyRecord(node, context, bufferOrOptions, options);
    }
    return isRenderBuffer(bufferOrOptions)
      ? node.render(context, bufferOrOptions, options)
      : node.render(context, bufferOrOptions);
  }

  override render(context: Context, buffer: RenderBuffer, options?: PrintOptions): MaybePromise<string>;
  override render(context: Context, options?: PrintOptions): string;
  override render(context: Context, bufferOrOptions?: RenderBuffer | PrintOptions, options?: PrintOptions): string | MaybePromise<string> {
    const node = this._evalForAtRuleRender(context);
    return isThenable(node)
      ? node.then(resolved => this.renderEvaluatedValue(resolved, context, bufferOrOptions, options))
      : this.renderEvaluatedValue(node, context, bufferOrOptions, options);
  }

  /**
   * Prepare name identity and body registration.
   * Prelude evaluation stays in evalNode so live-scope lookups stay correct.
   */
  override prepareRegistration(context: Context): MaybePromise<this> {
    if (!this.registrationPrepared) {
      const prepared = this._prepareAtRuleNameIdentity(context);
      if (isThenable(prepared)) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- AtRule subclasses return same instance via withParts/ownParts; cast to this is safe
        return (prepared as Promise<AtRule>).then(node => this._prepareAtRuleRegistration(node, context, this)) as Promise<this>;
      }
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- same as above
      return this._prepareAtRuleRegistration(prepared as AtRule, context, this) as MaybePromise<this>;
    }
    return this;
  }

  private _prepareAtRuleNameIdentity(context: Context): MaybePromise<AtRule> {
    if (!(this.name instanceof Interpolated)) {
      return this;
    }

    const node = this.withParts({
      name: this.name,
      ...(this.prelude !== undefined && { prelude: this.prelude }),
      rules: this.rules
    });
    const finish = (key: Node): AtRule => {
      if (!(key instanceof Any)) {
        throw new TypeError('Expected interpolated at-rule name to resolve to Any');
      }
      node.adopt(key);
      node.name = key;
      node._valueOf = undefined;
      node.registrationPrepared = true;
      return node;
    };

    // node.name is Interpolated here (withParts preserves the type from this.name which was instanceof Interpolated)
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- name is Interpolated per the guard above
    const maybeKey = (node.name as Interpolated).eval(context);
    if (isThenable(maybeKey)) {
      return maybeKey.then(finish);
    }

    return finish(maybeKey);
  }

  private _prepareAtRuleRegistration(node: AtRule, context: Context, original: AtRule): MaybePromise<AtRule> {
    // Defer prelude evaluation to evalNode so variable lookups happen in the correct
    // live scope (e.g. mixin parameters referenced from nested @media preludes).
    return this._prepareAtRuleBodyRegistration(
      node,
      context,
      original,
      this.createBodyRegistrationSurface(node)
    );
  }

  private createBodyRegistrationSurface(node: AtRule): Rules {
    const surface = new Rules(
      node.rules,
      { rulesVisibility: { ...node.options.rulesVisibility } },
      node.location.length ? node.location : undefined,
      node.sourceRoot?._treeContext
    );
    surface.parent = node;
    surface.sourceNode = node;
    return surface;
  }

  private restoreBodyParentage(node: AtRule): void {
    for (let i = 0; i < node.rules.length; i++) {
      node.adopt(node.rules[i]!);
    }
  }

  private _prepareAtRuleBodyRegistration(
    node: AtRule,
    context: Context,
    original: AtRule,
    rules: Rules
  ): MaybePromise<AtRule> {
    const ensureDerived = (): AtRule => {
      if (node === original) {
        node = original.withParts({
          name: original.name,
          ...(original.prelude !== undefined && { prelude: original.prelude }),
          rules: original.rules
        });
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
    if (!rules.registrationPrepared) {
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
              node = ensureDerived();
              (node as { rules: Node[] }).rules = resolvedRules.rules;
              node.registrationPrepared = true;
            }
            this.restoreBodyParentage(node);
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
        node = ensureDerived();
        (node as { rules: Node[] }).rules = preparedRules.rules;
        node.registrationPrepared = true;
      }
      this.restoreBodyParentage(node);
    }
    return finalize();
  }

  private _setupAtRuleBodyRegistrationContext(
    node: AtRule,
    rules: Rules,
    context: Context
  ): AtRuleBodyRegistrationContext {
    const pushedExtendRoot = true;
    if (node.isNestable()) {
      const parent = context.extendRoots.getCurrentExtendRoot();
      context.extendRoots.registerRoot(rules, parent);
      context.extendRoots.pushExtendRoot(rules);
    } else {
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
    const atRuleName = normalizeAtRuleIdentityText(getAtRuleSourceIdentityText(node.name));
    const prelude = evaluatedPrelude ?? node.prelude;
    if (atRuleName === '@layer' && prelude) {
      const preludeStr = normalizeAtRuleIdentityText(getAtRuleSourceIdentityText(prelude));
      if (preludeStr) {
        let parentLayerName: string | undefined;
        const activeRecords = activeAtRuleBodyEvalRecords.get(context);
        if (activeRecords) {
          for (let i = activeRecords.length - 1; i >= 0; i--) {
            const record = activeRecords[i]!;
            const frame = record.source;
            if (
              frame === node
              || normalizeAtRuleIdentityText(getAtRuleSourceIdentityText(frame.name)) !== '@layer'
            ) {
              continue;
            }
            const recordLayerName = record.layerName;
            if (recordLayerName) {
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
      registerEvaluatedRulesetsForRoot(state.finalRules, state.finalRules);
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
    const rules = record.bodyRules ?? createAtRuleBodyEvalSurface(node, context);
    if (!node.isNestable()) {
      return createAtRuleBodyRecordRegistration(record, rules, {
        pushedExtendRoot: false
      });
    }
    const parentExtendRoot = context.extendRoots.getCurrentExtendRoot();
    context.extendRoots.registerRoot(rules, parentExtendRoot);
    context.extendRoots.pushExtendRoot(rules);
    let preparedRules: MaybePromise<Node>;
    try {
      preparedRules = rules.prepareRegistration(context);
    } catch (error) {
      context.extendRoots.popExtendRoot();
      restoreBodyEvalContext();
      throw error;
    }
    const finish = (resolved: Node): AtRuleBodyRegistrationState => {
      if (!(resolved instanceof Rules)) {
        context.extendRoots.popExtendRoot();
        restoreBodyEvalContext();
        throw new TypeError('Expected at-rule body registration prep to return Rules');
      }
      return createAtRuleBodyRecordRegistration(record, resolved, {
        parentExtendRoot,
        pushedExtendRoot: true
      });
    };
    return isThenable(preparedRules)
      ? preparedRules.then(finish, (error) => {
          context.extendRoots.popExtendRoot();
          restoreBodyEvalContext();
          throw error;
        })
      : finish(preparedRules);
  }

  getComparableHeaderString(options: FinalPrintOptions): string {
    if (typeof this.name === 'string' && options.atRuleHeaderNode !== this) {
      const prelude = typeof this.prelude === 'string'
        ? this.prelude
        : this.prelude !== undefined
          ? renderAtRuleHeaderNodeSyntax(this.prelude, options, true)
          : undefined;
      return buildComparableAtRuleHeader(this.name, prelude);
    }
    let { name } = this;
    let prelude = options.atRuleHeaderNode === this
      ? (options.atRuleHeaderPrelude ?? this.prelude)
      : this.prelude;

    if (hasCommentChild(name) || hasCommentChild(prelude)) {
      name = this.ownName(name);
      if (prelude) {
        prelude = this.ownNode(prelude);
      }
    }

    // When we reach here, name is Any|Interpolated (string case was handled by early return, or
    // atRuleHeaderNode===this which implies a Node name at runtime). Prelude is Node|undefined.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- name/prelude are Nodes in this branch (see comment above)
    const nameOut = renderAtRuleHeaderNodeSyntax(name as Node, options, true);
    const preludeTrivia = createTriviaMap();
    const preludePrintOptions: FinalPrintOptions = options.context && prelude
      ? {
          ...options,
          context: undefined,
          trivia: preludeTrivia,
          emittedTrivia: options.emittedTrivia
        }
      : {
          ...options,
          trivia: preludeTrivia
        };
    const preludeOut = prelude
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- prelude is Node here (string case handled above)
      ? renderAtRuleHeaderNodeSyntax(prelude as Node, preludePrintOptions, true)
      : undefined;
    return buildComparableAtRuleHeader(nameOut, preludeOut);
  }

  writeHeader(options: FinalPrintOptions, withoutComments?: boolean): boolean {
    if (!withoutComments && typeof this.name === 'string' && options.atRuleHeaderNode !== this) {
      const w = options.writer;
      const idt = indent(options.depth);
      if (idt) {
        w.add(idt);
      }
      w.add(this.name, this);
      const preludeOut = typeof this.prelude === 'string'
        ? this.prelude
        : this.prelude !== undefined
          ? renderAtRuleHeaderNodeSyntax(this.prelude, options, withoutComments)
          : undefined;
      if (preludeOut !== undefined && hasNonAtRuleWhitespace(preludeOut)) {
        if (!endsWithAtRuleWhitespace(this.name) && !startsWithAtRuleWhitespace(preludeOut)) {
          w.add(' ');
        }
        w.add(preludeOut, this.prelude ?? this);
      }
      w.add(' {\n');
      return true;
    }

    let { name } = this;
    let prelude = options.atRuleHeaderNode === this
      ? (options.atRuleHeaderPrelude ?? this.prelude)
      : this.prelude;

    if (withoutComments && (hasCommentChild(name) || hasCommentChild(prelude))) {
      name = this.ownName(name);
      if (prelude) {
        prelude = this.ownNode(prelude);
      }
    }

    const w = options.writer;
    const idt = indent(options.depth);
    if (idt) {
      w.add(idt);
    }

    // When we reach here, name is Any|Interpolated (string+no-override case handled above).
    // Prelude is Node|undefined (string case handled in the early return block).
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- name/prelude are Nodes in this branch
    const nameNode = name as Node;
    const nameOut = renderAtRuleHeaderNodeSyntax(nameNode, options, withoutComments);
    w.add(nameOut, nameNode);
    if (prelude) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- prelude is Node here
      const preludeNode = prelude as Node;
      const preludeTrivia = withoutComments
        ? createTriviaMap()
        : options.trivia ?? preludeNode.sourceRoot?._treeContext?.opts?.trivia;
      const preludePrintOptions: FinalPrintOptions = options.context && preludeTrivia
        ? {
            ...options,
            context: undefined,
            trivia: preludeTrivia,
            emittedTrivia: options.emittedTrivia
          }
        : options;
      const preludeOut = renderAtRuleHeaderNodeSyntax(preludeNode, preludePrintOptions, withoutComments);
      if (hasNonAtRuleWhitespace(preludeOut)) {
        const nameEndsWithSpace = endsWithAtRuleWhitespace(nameOut);
        const preludeStartsWithSpace = startsWithAtRuleWhitespace(preludeOut);
        let finalPreludeOut = preludeOut;
        if (preludeStartsWithSpace) {
          finalPreludeOut = trimAtRuleLeadingWhitespace(preludeOut, nameEndsWithSpace ? '' : ' ');
        } else if (!nameEndsWithSpace) {
          w.add(' ');
        }
        w.add(finalPreludeOut, preludeNode);
      }
    }

    w.add(' {\n');
    return true;
  }

  /** Render the opening of this at-rule (name and prelude) */
  getHeaderString(options: FinalPrintOptions, withoutComments?: boolean): string {
    if (!withoutComments && typeof this.name === 'string' && options.atRuleHeaderNode !== this) {
      const rules = options.atRuleBodyNode === this
        ? options.atRuleBodyOverride
        : this.getRenderRules();
      const idt = indent(options.depth);
      let out = idt + this.name;
      const preludeOut = typeof this.prelude === 'string'
        ? this.prelude
        : this.prelude !== undefined
          ? renderAtRuleHeaderNodeSyntax(this.prelude, options, withoutComments)
          : undefined;
      if (preludeOut !== undefined && hasNonAtRuleWhitespace(preludeOut)) {
        if (!endsWithAtRuleWhitespace(this.name) && !startsWithAtRuleWhitespace(preludeOut)) {
          out += ' ';
        }
        out += preludeOut;
      }
      return rules
        ? normalizeIndent(trimAtRuleTrailingWhitespace(out) + ' {', idt) + '\n'
        : normalizeIndent(trimAtRuleTrailingWhitespace(out) + ';', idt);
    }

    let { name } = this;
    let prelude = options.atRuleHeaderNode === this
      ? (options.atRuleHeaderPrelude ?? this.prelude)
      : this.prelude;
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

    // When we reach here, name is Any|Interpolated (string+no-override case handled above).
    // Prelude is Node|undefined (string case handled in the early return block).
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- name/prelude are Nodes in this branch
    const nameNode = name as Node;
    const nameOut = renderAtRuleHeaderNodeSyntax(nameNode, options, withoutComments);
    if (prelude) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- prelude is Node here
      const preludeNode = prelude as Node;
      const preludeTrivia = withoutComments
        ? createTriviaMap()
        : options.trivia ?? preludeNode.sourceRoot?._treeContext?.opts?.trivia;
      const preludePrintOptions: FinalPrintOptions = options.context && preludeTrivia
        ? {
            ...options,
            context: undefined,
            trivia: preludeTrivia,
            emittedTrivia: options.emittedTrivia
          }
        : options;
      const preludeOut = renderAtRuleHeaderNodeSyntax(preludeNode, preludePrintOptions, withoutComments);
      if (!hasNonAtRuleWhitespace(preludeOut)) {
        out += nameOut;
        if (rules) {
          out = normalizeIndent(trimAtRuleTrailingWhitespace(out) + ' {', idt) + '\n';
        } else {
          out = normalizeIndent(trimAtRuleTrailingWhitespace(out) + ';', idt);
        }
        return out;
      }
      const nameEndsWithSpace = endsWithAtRuleWhitespace(nameOut);
      const preludeStartsWithSpace = startsWithAtRuleWhitespace(preludeOut);
      const interstitialTrivia = withoutComments
        ? ''
        : renderAtRuleBetweenNameAndPreludeTrivia(nameNode, preludeNode, options);

      out += nameOut;
      if (interstitialTrivia) {
        out += interstitialTrivia;
      }
      // If name ends with space AND prelude starts with space, trim the prelude's leading space
      // Otherwise, add a space only if neither has spacing
      let finalPreludeOut = preludeOut;
      if (interstitialTrivia) {
        finalPreludeOut = trimAtRuleLeadingWhitespace(preludeOut);
      } else if (preludeStartsWithSpace) {
        finalPreludeOut = trimAtRuleLeadingWhitespace(preludeOut, nameEndsWithSpace ? '' : ' ');
      } else if (!nameEndsWithSpace && !preludeStartsWithSpace) {
        out += ' ';
      }
      out += finalPreludeOut;
      const preludePost = withoutComments
        ? ''
        : renderAtRulePostPreludeTrivia(preludeNode, options);
      out += preludePost;
      if (rules) {
        const preludeEndsWithSpace = preludePost
          ? endsWithAtRuleWhitespace(preludePost)
          : endsWithAtRuleWhitespace(preludeOut);
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
        out = normalizeIndent(trimAtRuleTrailingWhitespace(out) + ' {', idt) + '\n';
      } else {
        out = normalizeIndent(out + ';', idt);
      }
    }
    return out;
  }

  override evalNode(context: Context): MaybePromise<Rules> {
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
      return (out as Promise<AtRule | Nil>).then((value) => {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Nil is a valid node result; declared return type is Rules for base compat
        return (value instanceof AtRule
          ? createAtRuleEvalResultNode(this, record)
          : value) as Rules;
      });
    }
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Nil is a valid node result; declared return type is Rules for base compat
    return (out instanceof AtRule
      ? createAtRuleEvalResultNode(this, record)
      : out) as Rules;
  }

  private evalBodyNode(
    context: Context,
    bodyEvalRecord: AtRuleBodyEvalRecord
  ): MaybePromise<AtRule | Nil> {
    const source = bodyEvalRecord.source;
    let node = bodyEvalRecord.evalFrame;
    // @plugin is handled by the Less compatibility plugin during preparation.
    // If we reach eval and it's still visible, no plugin processed it.
    const atName = getAtRuleSourceIdentityText(node.name);
    if (atName === '@plugin' && node.visible) {
      throw new Error('@plugin is only supported when using the Less compatibility plugin (@jesscss/plugin-less-compat).');
    }

    // Store frames snapshot for hoisting serialization
    if (context.opts.output?.collapseNesting || node.hoistToRoot) {
      const frames = [...context.frames];
      setAtRuleBodyEvalOutput(bodyEvalRecord, {
        frames
      });
    }

    const finishVisibility = (): AtRule => {
      const rules = bodyEvalRecord.evaluatedBody ?? bodyEvalRecord.bodyRules;
      const hasVisibleRules = rules
        ? rules.hasVisibleRules()
        : hasVisibleRuleNodes(node.getRenderRules());
      if (!hasVisibleRules) {
        storeAtRuleBodyEvalRecordVisibility(bodyEvalRecord, false);
      }
      return node;
    };
    const finishBodyEval = (): MaybePromise<AtRule> => {
      if (bodyEvalRecord.renderSourceBody) {
        return finishVisibility();
      }
      let rules = bodyEvalRecord.bodyRules ?? createAtRuleBodyEvalSurface(node, context);
      if (rules) {
        const out = source.runBodyEvalInvocation(context, bodyEvalRecord, node, (restoreBodyEvalContext) => {
          const finishPreparedBody = (registration: AtRuleBodyRegistrationState): MaybePromise<AtRule> => {
            const { bodyToEval } = registration;
            const onlyRuleSetChild = isNode(bodyToEval.rules[0], N.Ruleset);
            const finishEval = (r: Rules): AtRule => {
              const firstRule = r.rules[0];
              const finalRules = onlyRuleSetChild && isDirectRulesNode(firstRule) ? firstRule : r;
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
                ? (evalOut as Promise<Rules>).then(finishEval)
                : finishEval(evalOut as Rules);
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
    const { prelude } = node;
    if (prelude) {
      if (typeof prelude === 'string') {
        return finishBodyEval();
      }
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
        return (out as Promise<T>).then(
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
    if (this.hasFlag(F_STATIC)) {
      return this;
    }
    if (this.registrationPrepared) {
      return this.eval(context);
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
