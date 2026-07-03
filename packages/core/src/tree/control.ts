import { Node, defineType, F_VISIBLE, F_NON_STATIC, F_MAY_ASYNC, type NodeLocation, type LocationInfo, type NodeOptions } from './node.js';
import type { Context } from '../context.js';
import { Rules } from './rules.js';
import { Any } from './any.js';
import { Num } from './number.js';
import { Bool } from './bool.js';
import { Condition } from './condition.js';

import { VarDeclaration } from './declaration-var.js';
import { isNode } from './util/is-node.js';
import { N } from './node-type.js';
import { type FinalPrintOptions, type PrintOptions, getPrintOptions } from './util/print.js';
import type { MaybePromise } from '@jesscss/awaitable-pipe';
import { Range } from './range.js';
import {
  buildScopeFrame,
  copyScopeFrameLiveBindingSlots,
  getBindingCellValue,
  setScopeFrameLiveBinding,
  type BindingCell,
  type ScopeFrame
} from './scope-frame.js';
import {
  createRenderBuffer,
  isRenderBuffer,
  type RenderBuffer
} from './util/render-buffer.js';
import { copyWithReusableLeaves } from './util/cloning.js';

const PUBLIC_RULE_VISIBILITY = {
  Declaration: 'public',
  Ruleset: 'public',
  VarDeclaration: 'public',
  Mixin: 'public'
} as const;
const MAX_WHILE_ITERATIONS = 10000;

function throwWhileIterationLimitExceeded(): never {
  throw new Error(`$while exceeded ${MAX_WHILE_ITERATIONS} iterations`);
}

function throwInvalidWhileIterationRegistrationPrep(): never {
  throw new TypeError('Expected $while iteration registration prep to return Rules');
}

// Accept either a bare Node array or a Rules container node (unwrapped to its
// child array). Factories pass a Rules node; the parser passes the array.
function normalizeRulesBody(owner: string, rules: unknown): Node[] {
  const arr = rules instanceof Rules ? rules.rules : rules;
  if (!Array.isArray(arr)) {
    throw new TypeError(`${owner} requires rules to be a Node array.`);
  }
  return arr;
}

function makeDirectiveRulesPublic(rules: Rules<any>) {
  rules.options.rulesVisibility = {
    ...rules.options.rulesVisibility,
    ...PUBLIC_RULE_VISIBILITY
  };
}

// The control node IS its own body (like the canonical Mixin/Ruleset): parent its
// body children to `this`. `new If/For/While` (parser + `makeLoop`) does not run
// the factory `parentChildren`, so without this the children stay parented to the
// discarded `value.rules` wrapper. Owning them is what lets a per-iteration THIN
// surface (`sourceNode` → the control node) recognize the shared children as reused
// source children and skip re-adopting them (rules.ts `_storePreparedRegistrationNode`).
function ownControlBodyChildren(owner: Rules<any>): void {
  const children = owner.rules;
  for (let i = 0; i < children.length; i++) {
    const child = children[i]!;
    if (child instanceof Node) {
      owner.adopt(child);
    }
  }
}

function renderControlToString(render: (buffer: RenderBuffer) => MaybePromise<string>): MaybePromise<string> {
  return render(createRenderBuffer('flat'));
}

function writeControlChildSyntax(node: Node, options: FinalPrintOptions): void {
  const saved = options.suppressBoundaryTrivia;
  options.suppressBoundaryTrivia = 'pre';
  try {
    node.writeSyntax(options);
  } finally {
    options.suppressBoundaryTrivia = saved;
  }
}

function trimControlTrailingNewline(buffer: RenderBuffer, out: string): string {
  if (!out.endsWith('\n')) {
    return out;
  }
  if (buffer.kind === 'flat') {
    const lastIndex = buffer.parts.length - 1;
    const last = buffer.parts[lastIndex];
    if (typeof last === 'string' && last.endsWith('\n')) {
      buffer.parts[lastIndex] = last.slice(0, -1);
    }
  } else {
    const lastIndex = buffer.segments.length - 1;
    const last = buffer.segments[lastIndex];
    if (typeof last === 'string' && last.endsWith('\n')) {
      buffer.segments[lastIndex] = last.slice(0, -1);
    }
  }
  return out.slice(0, -1);
}

async function renderControlRules(
  rules: Rules<any>,
  context: Context,
  buffer: RenderBuffer,
  options?: PrintOptions
): Promise<string> {
  const out = await Promise.resolve(rules.render(context, buffer, options));
  return trimControlTrailingNewline(buffer, out);
}

function createDerivedIterationRulesSurface(
  sourceRules: Rules<any>,
  childNodes?: Node[],
  shareChildren = false
): Rules {
  const sourceOptions = sourceRules.options;
  const sourceLocation = sourceRules.location.length === 0
    ? undefined
    : sourceRules.location;
  const output = new Rules(
    [],
    {
      ...sourceOptions,
      rulesVisibility: { ...sourceOptions.rulesVisibility }
    },
    sourceLocation,
    sourceRules._treeContext
  ).inherit(sourceRules);
  if (sourceRules.functionsByName) {
    output.functionsByName = new Map(sourceRules.functionsByName);
  }
  output.scopeFrame = undefined;
  if (childNodes) {
    if (shareChildren) {
      // THIN SURFACE: share the canonical body children WITHOUT adopting them
      // (direct array push, like `Rules.derive`) so their `.parent` is never
      // rewritten to this ephemeral per-iteration surface. The caller sets
      // `output.sourceNode` to the loop body so shared children re-point their
      // scope frame to this surface via §4. Flags come from `.inherit()` above.
      for (const childNode of childNodes) {
        output.rules.push(childNode);
      }
    } else {
      // COPY path ($while): the children are per-iteration COPIES owned by this
      // surface — adopt + register them normally.
      for (const childNode of childNodes) {
        output.push(childNode);
      }
    }
  }
  return output;
}

function createGeneratedOutputRulesSurface(childNodes?: Node[]): Rules {
  const output = new Rules([]);
  if (childNodes) {
    for (const childNode of childNodes) {
      output.push(childNode);
    }
  }
  return output;
}

async function runWithRulesContext<T>(
  context: Context,
  rulesContext: Rules<any>,
  run: () => Promise<T>
): Promise<T> {
  const savedRulesContext = context.rulesContext;
  context.rulesContext = rulesContext;
  try {
    return await run();
  } finally {
    context.rulesContext = savedRulesContext;
  }
}

function deriveIterationChild(node: Node): Node {
  return copyWithReusableLeaves(node);
}

// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- cloneFn preserves the VarDeclaration field type of each binding decl.
function cloneForPattern(pattern: ForPattern, cloneFn: (n: Node) => Node): ForPattern {
  if (pattern.kind === 'single') {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    return { kind: 'single', value: cloneFn(pattern.value) as VarDeclaration };
  }
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  const values = pattern.values.map(v => cloneFn(v) as VarDeclaration) as [VarDeclaration, ...VarDeclaration[]];
  return { kind: 'tuple', values };
}

function cloneForIterable(iterable: ForIterable, cloneFn: (n: Node) => Node): ForIterable {
  if (iterable.kind === 'node') {
    return { kind: 'node', value: cloneFn(iterable.value) };
  }
  return {
    kind: 'range',
    start: cloneFn(iterable.start),
    end: cloneFn(iterable.end),
    ...(iterable.step !== undefined && { step: cloneFn(iterable.step) }),
    includeStart: iterable.includeStart,
    includeEnd: iterable.includeEnd
  };
}

// `share` = THIN surface: share the canonical body children (a per-iteration
// surface with `sourceNode` → the loop body, so shared children re-point their
// scope frame via §4). Used by `$for`/`$if`, where each iteration/branch is an
// independent evaluation — no intra-loop state carried on the body.
//
// `share=false` = COPY per iteration. Used by `$while`, which carries mutable
// state ACROSS iterations (`$while` body reads and writes the same vars, e.g.
// `i = i + 1` + `tick: @i`). A stateful iteration genuinely needs an isolated body
// so one iteration's evaluated-reference/value state cannot leak into the next;
// sharing the body would make the counter read a stale value. The per-iteration
// copy already reuses scalar leaves (copyWithReusableLeaves only shallow-copies
// containers), so its cost is bounded.
function createIterationEvalSurface(sourceRules: Rules<any>, share = true): Rules {
  const iterationRules = createDerivedIterationRulesSurface(
    sourceRules,
    share ? [...sourceRules.rules] : sourceRules.rules.map(deriveIterationChild),
    share
  );
  if (share) {
    iterationRules.sourceNode = sourceRules.sourceNode ?? sourceRules;
  }
  iterationRules.options.rulesVisibility = {
    ...iterationRules.options.rulesVisibility,
    ...PUBLIC_RULE_VISIBILITY
  };
  return iterationRules;
}

function createWhileStateSurface(sourceRules: Rules<any>, context: Context): Rules {
  const stateRules = createDerivedIterationRulesSurface(
    sourceRules
  );
  const parentFrame: ScopeFrame | undefined = isNode(context.rulesContext, N.Rules)
    ? context.rulesContext.getScopeFrame()
    : undefined;
  // Stage 3 / R3: build a COVERED frame (declarationsCovered=true) like the $for
  // iteration surface. State + iteration frames are the ONLY remaining
  // `declarationsCovered=false` scopes in the suite; an uncovered frame forces
  // variable lookup down the `direct-rules-lookup` fallback (which drops the owner
  // frame). The state surface carries live loop state (synced via syncWhileState)
  // and body vardecls register during eval, so a covered empty index is correct —
  // exactly as $for already does (createForIterationSurface passes `true`).
  stateRules.scopeFrame = buildScopeFrame(undefined, stateRules, parentFrame, new Map(), undefined, true);
  return stateRules;
}

function createWhileIterationSurface(sourceRules: Rules<any>, stateRules: Rules): Rules {
  // THIN surface (share the body, like $for/$if). The current loop state is exposed
  // as LIVE SLOTS directly ON this iteration's fresh frame (copied from stateRules),
  // parent = the placement scope — so the shared body SEES the synced state and each
  // iteration's fresh cells re-resolve instead of caching against a stable frame.
  //
  // KNOWN GAP (SINGLE_FRAME_PLAN.md "WHY $while can't share yet"): a self-referential
  // state vardecl (`i: i+1`) still registers a NEW `i` binding holding the raw i+1 node,
  // overwriting the live slot, so a stateful counter renders `1,1,1`. The fix is a
  // declaration-set-semantics change (a $while body vardecl over a live slot is an
  // UPDATE, not a shadow). Committed as architecture progress; being pushed forward.
  const stateFrame = stateRules.getScopeFrame();
  const iterationRules = createIterationEvalSurface(sourceRules, true);
  iterationRules.scopeFrame = buildScopeFrame(
    undefined,
    iterationRules,
    stateFrame.parent,
    copyScopeFrameLiveBindingSlots(stateFrame),
    undefined,
    true
  );
  return iterationRules;
}

function hasIterationStateMutation(rules: Rules<any>): boolean {
  return rules.rules.some(node => isNode(node, N.VarDeclaration));
}

async function syncWhileState(
  stateRules: Rules<any>,
  iterationRules: Rules<any>,
  context: Context
): Promise<void> {
  const stateFrame = stateRules.getScopeFrame();
  const iterationFrame = iterationRules.getScopeFrame();
  for (const [name, bucket] of iterationFrame.declarationBucketsByName) {
    const last = bucket[bucket.length - 1];
    if (!last) {
      continue;
    }
    const value = await getBindingCellValue(last.cell).eval(context);
    setScopeFrameLiveBinding(stateFrame, name, {
      value,
      sourceNode: last.sourceNode,
      readonly: last.cell.readonly
    });
  }
}

export type ForPattern =
  | {
    kind: 'single';
    value: VarDeclaration;
  }
  | {
    kind: 'tuple';
    values: [VarDeclaration, ...VarDeclaration[]];
  };

export type ForIterable =
  | {
    kind: 'node';
    value: Node;
  }
  | {
    kind: 'range';
    start: Node;
    end: Node;
    step?: Node;
    includeStart: boolean;
    includeEnd: boolean;
  };

function getBindingDeclarations(pattern: ForPattern): VarDeclaration[] {
  if (pattern.kind === 'single') {
    return [pattern.value];
  }
  if (pattern.kind === 'tuple') {
    return [...pattern.values];
  }
  return [];
}

async function* resolveEntries(input: Node, context: Context): AsyncGenerator<[Node, number | string | Node]> {
  if (isNode(input, N.Expression)) {
    yield* resolveEntries(await input.value.eval(context), context);
    return;
  }
  if (isNode(input, N.Call)) {
    const evald = await input.eval(context);
    if (isNode(evald, N.Call)) {
      yield [evald, 0];
      return;
    }
    yield* resolveEntries(evald, context);
    return;
  }
  if (isNode(input, N.List)) {
    for (let key = 0; key < input.value.length; key++) {
      const value = input.value[key]!;
      yield [value, key];
    }
    return;
  }
  if (isNode(input, N.Sequence)) {
    for (let key = 0; key < input.value.length; key++) {
      const value = input.value[key]!;
      yield [value, key];
    }
    return;
  }
  if (isNode(input, N.Rules)) {
    const rules = input.rules;
    for (const rule of rules) {
      if (!rule || isNode(rule, N.Comment)) {
        continue;
      }
      if (!isNode(rule, N.Declaration)) {
        continue;
      }
      if (rule.value instanceof Node) {
        yield [rule.value, rule.name];
      }
    }
    return;
  }
  if (isNode(input, N.Ruleset) || isNode(input, N.Mixin)) {
    const rules = input.rules;
    for (const rule of rules) {
      if (!rule || isNode(rule, N.Comment)) {
        continue;
      }
      if (!isNode(rule, N.Declaration)) {
        continue;
      }
      if (rule.value instanceof Node) {
        yield [rule.value, rule.name];
      }
    }
    return;
  }
  yield [input, 0];
}

function iterableToNode(iterable: ForIterable): Node {
  if (iterable.kind === 'node') {
    return iterable.value;
  }
  return new Range(
    {
      start: iterable.start,
      end: iterable.end,
      step: iterable.step
    },
    {
      includeStart: iterable.includeStart,
      includeEnd: iterable.includeEnd
    }
  );
}

function getForBindingInfo(pattern: ForPattern): {
  bindingDecls: VarDeclaration[];
  bindingNames: string[];
} {
  const bindingDecls = getBindingDeclarations(pattern);
  if (bindingDecls.length === 0) {
    throw new Error('Invalid $for header: missing binding variable');
  }
  return {
    bindingDecls,
    bindingNames: bindingDecls.map(entry => entry.name.valueOf())
  };
}

async function createForIterationSurface(
  originalRules: Rules<any>,
  context: Context,
  bindingDecls: VarDeclaration[],
  bindingNames: string[],
  value: Node,
  key: number | string | Node,
  counter: number
): Promise<Rules> {
  const resolvedValue = await value.eval(context);
  let resolvedKey: Node;
  if (typeof key === 'number') {
    resolvedKey = new Num(key + 1);
  } else if (typeof key === 'string' && key === 'value') {
    resolvedKey = new Num(counter);
  } else if (isNode(key)) {
    resolvedKey = await key.eval(context);
  } else {
    resolvedKey = new Any(String(key), { role: 'property' });
  }

  const iterationRules = createIterationEvalSurface(originalRules);

  const bindings: Node[] = [resolvedValue, resolvedKey, new Num(counter)];
  const liveSlots = new Map<string, BindingCell>();
  for (let i = Math.min(bindingDecls.length, bindings.length) - 1; i >= 0; i--) {
    const bindingDecl = bindingDecls[i]!;
    liveSlots.set(bindingNames[i]!, {
      value: bindings[i]!,
      sourceNode: bindingDecl,
      readonly: bindingDecl.options?.readonly
    });
  }
  const parentFrame: ScopeFrame | undefined = isNode(context.rulesContext, N.Rules)
    ? context.rulesContext.getScopeFrame()
    : undefined;
  iterationRules.scopeFrame = buildScopeFrame(
    undefined,
    iterationRules,
    parentFrame,
    liveSlots,
    undefined,
    true
  );
  return iterationRules.prepareRegistration(context);
}

export type IfValue = {
  condition: Node;
  rules: Node[];
  else?: If | Rules;
};

/**
 * A control-flow block that serializes as:
 * - `$if (...) { ... }`
 * - `$else if (...) { ... }`
 * - `$else { ... }`
 *
 * This is language-agnostic: it’s the canonical Jess control node.
 */
export class If extends Rules<IfValue> {
  static override childKeys = ['condition', 'rules', 'else'] as const;

  readonly condition: Node;
  readonly else: IfValue['else'];
  declare readonly rules: Node[];

  override allowRoot = true;
  override allowRuleRoot = true;

  constructor(value: IfValue, options?: NodeOptions, location?: NodeLocation, treeContext?: Context['treeContext']) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- NodeLocation is LocationInfo | []; parsers always pass a full 6-element tuple or undefined.
    super(normalizeRulesBody('If', value.rules), options, location as LocationInfo | undefined, treeContext);
    this.condition = value.condition;
    this.else = value.else;
    this.addFlags(F_VISIBLE, F_NON_STATIC, F_MAY_ASYNC);
    this.adopt(this.condition);
    if (this.else) {
      this.adopt(this.else);
      makeDirectiveRulesPublic(this.else);
    }
    makeDirectiveRulesPublic(this);
    // R2 single-frame: the If IS its own body (no `_passedRulesWrapper`) — own the
    // body children so per-iteration thin surfaces recognize them as reused.
    ownControlBodyChildren(this);
  }

  override toTrimmedString(rawOptions?: PrintOptions): string {
    const options = getPrintOptions(rawOptions);
    const w = options.writer!;
    const position = w.position();
    this.writeSyntax(options);
    return w.getSince(position);
  }

  /** @internal */
  override writeSyntax(options: FinalPrintOptions): void {
    const w = options.writer;
    w.add('$if', this);
    w.add(' (');
    this.condition.writeSyntax(options);
    w.add(') ');
    this.writeBraced(options);
    this.writeElseSyntax(options);
  }

  private writeElseSyntax(options: FinalPrintOptions): void {
    if (!this.else) {
      return;
    }
    const w = options.writer;
    if (this.else instanceof If) {
      w.add(' $else if (');
      this.else.condition.writeSyntax(options);
      w.add(') ');
      this.else.writeBraced(options);
      this.else.writeElseSyntax(options);
      return;
    }
    w.add(' $else ');
    this.else.writeBraced(options);
  }

  override evalNode(context: Context): MaybePromise<Rules> {
    const run = async (): Promise<Rules> => {
      let conditionPasses: boolean;
      if (this.condition instanceof Condition) {
        conditionPasses = await this.condition.evaluateBoolean(context);
      } else {
        const condition = await this.condition.eval(context);
        conditionPasses = condition instanceof Bool && condition.value === true;
      }
      if (conditionPasses) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- eval() returns MaybePromise<Node>; the result is a Rules surface created by createIterationEvalSurface.
        return createIterationEvalSurface(this).eval(context) as Promise<Rules>;
      }
      if (this.else) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- eval() returns MaybePromise<Node>; the else branch evaluates to a Rules node.
        return this.else.eval(context) as Promise<Rules>;
      }
      return createGeneratedOutputRulesSurface();
    };
    return run();
  }

  private async renderSelectedBranch(
    context: Context,
    buffer: RenderBuffer,
    options?: PrintOptions
  ): Promise<string> {
    let conditionPasses: boolean;
    if (this.condition instanceof Condition) {
      conditionPasses = await this.condition.evaluateBoolean(context);
    } else {
      const condition = await this.condition.eval(context);
      conditionPasses = condition instanceof Bool && condition.value === true;
    }
    if (conditionPasses) {
      return renderControlRules(createIterationEvalSurface(this), context, buffer, options);
    }
    return this.else
      ? renderControlRules(this.else, context, buffer, options)
      : '';
  }

  override render(context: Context, buffer: RenderBuffer, options?: PrintOptions): MaybePromise<string>;
  override render(context: Context, options?: PrintOptions): string;
  override render(context: Context, bufferOrOptions?: RenderBuffer | PrintOptions, options?: PrintOptions): string | MaybePromise<string> {
    if (isRenderBuffer(bufferOrOptions)) {
      return this.renderSelectedBranch(context, bufferOrOptions, options);
    }
    return renderControlToString(buffer => this.renderSelectedBranch(context, buffer, bufferOrOptions));
  }

  override resolve(_context: Context): this {
    return this;
  }
}

export type StructuredLoopValue = {
  pattern: ForPattern;
  iterable: ForIterable;
  rules: Node[];
};

/**
 * `$for <header> { ... }`
 */
export class For extends Rules<StructuredLoopValue> {
  static override childKeys = ['pattern', 'iterable', 'rules'] as const;

  readonly pattern: ForPattern;
  readonly iterable: ForIterable;
  declare readonly rules: Node[];

  override allowRoot = true;
  override allowRuleRoot = true;

  constructor(value: StructuredLoopValue, options?: NodeOptions, location?: NodeLocation, treeContext?: Context['treeContext']) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- NodeLocation is LocationInfo | []; parsers always pass a full 6-element tuple or undefined.
    super(normalizeRulesBody('For', value.rules), options, location as LocationInfo | undefined, treeContext);
    this.pattern = value.pattern;
    this.iterable = value.iterable;
    this.addFlags(F_VISIBLE, F_NON_STATIC, F_MAY_ASYNC);
    for (const decl of getBindingDeclarations(this.pattern)) {
      this.adopt(decl);
    }
    if (this.iterable.kind === 'node') {
      this.adopt(this.iterable.value);
    } else {
      this.adopt(this.iterable.start);
      this.adopt(this.iterable.end);
      if (this.iterable.step) {
        this.adopt(this.iterable.step);
      }
    }
    makeDirectiveRulesPublic(this);
    // R2 single-frame: the For IS its own body (no `_passedRulesWrapper`) — own the
    // body children so per-iteration thin surfaces recognize them as reused.
    ownControlBodyChildren(this);
    // Carry function bindings from a factory-passed rules wrapper so iteration
    // surfaces can look them up during eval (createIterationEvalSurface reads
    // this.functionsByName).
    if (value.rules instanceof Rules && value.rules.functionsByName) {
      for (const [name, fn] of value.rules.functionsByName) {
        this.setFunctionBinding(name, fn);
      }
    }
  }

  // For carries a structured value (pattern + iterable + body), so the base
  // Rules.clone — which reconstructs from a bare Node[] — cannot rebuild it.
  // Clone the structured parts too so the source loop template is not mutated
  // when a placement clone re-adopts shared binding/iterable nodes.
  override clone(cloneFn?: (n: Node) => Node): this {
    // Shallow: share the body children; the pattern's binding decls and the
    // iterable are shallow-cloned (one node each, shared value) because the For
    // constructor adopts them and must not reparent the source template's nodes.
    const mapPart = cloneFn ?? ((n: Node) => n.clone());
    const rules = cloneFn ? this.rules.map(cloneFn) : [...this.rules];
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    return new For(
      {
        pattern: cloneForPattern(this.pattern, mapPart),
        iterable: cloneForIterable(this.iterable, mapPart),
        rules
      },
      this._options ? { ...this._options } : undefined,
      this.location.length ? this.location : undefined,
      this.sourceRoot?._treeContext
    ).inherit(this) as this;
  }

  override derive(value: Node[] = [...this.rules]): For {
    return new For(
      {
        pattern: cloneForPattern(this.pattern, n => n.clone()),
        iterable: cloneForIterable(this.iterable, n => n.clone()),
        rules: value
      },
      this._options ? { ...this._options } : undefined,
      this.location.length ? this.location : undefined,
      this.sourceRoot?._treeContext
    ).inherit(this);
  }

  override evalNode(context: Context): MaybePromise<Rules> {
    const { pattern, iterable } = this;
    const { bindingDecls, bindingNames } = getForBindingInfo(pattern);
    const run = async (): Promise<Rules> => {
      const outputRules: Node[] = [];
      let counter = 1;
      const originalRules = this;
      const evaluatedIterable = await iterableToNode(iterable).eval(context);
      for await (const [value, key] of resolveEntries(evaluatedIterable, context)) {
        const iterationRules = await createForIterationSurface(
          originalRules,
          context,
          bindingDecls,
          bindingNames,
          value,
          key,
          counter
        );
        counter++;
        const result = await iterationRules.eval(context);

        if (isNode(result, N.Rules)) {
          result.scopeFrame = undefined;
          outputRules.push(result);
        } else {
          outputRules.push(result);
        }
      }
      if (outputRules.length === 0) {
        return createGeneratedOutputRulesSurface();
      }
      if (outputRules.length === 1) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- single iteration result; control-flow confirms it was pushed as a Rules or Node that behaves as Rules.
        return outputRules[0]! as Rules;
      }
      return createGeneratedOutputRulesSurface(outputRules);
    };
    return run();
  }

  override resolve(context: Context): MaybePromise<Node> {
    return this.evalNode(context);
  }

  override toTrimmedString(rawOptions?: PrintOptions): string {
    const options = getPrintOptions(rawOptions);
    const w = options.writer!;
    const position = w.position();
    this.writeSyntax(options);
    return w.getSince(position);
  }

  /** @internal */
  override writeSyntax(options: FinalPrintOptions): void {
    const w = options.writer;
    w.add('$for ', this);
    w.add('(');
    if (this.pattern.kind === 'single') {
      this.pattern.value.writeSyntax(options);
    } else {
      w.add('[');
      const values = this.pattern.values;
      for (let i = 0; i < values.length; i++) {
        values[i]!.writeSyntax(options);
        if (i < values.length - 1) {
          w.add(', ');
        }
      }
      w.add(']');
    }
    w.add(' of ');
    if (this.iterable.kind === 'node') {
      this.iterable.value.writeSyntax(options);
    } else {
      writeControlChildSyntax(this.iterable.start, options);
      if (!this.iterable.includeStart) {
        w.add('>');
      }
      w.add(' to ');
      if (!this.iterable.includeEnd) {
        w.add('<');
      }
      writeControlChildSyntax(this.iterable.end, options);
      if (this.iterable.step) {
        w.add(' step ');
        writeControlChildSyntax(this.iterable.step, options);
      }
    }
    w.add(')');
    w.add(' ');
    this.writeBraced(options);
  }

  private async renderIterations(
    context: Context,
    buffer: RenderBuffer,
    options?: PrintOptions
  ): Promise<string> {
    const { pattern, iterable } = this;
    const originalRules = this;
    const { bindingDecls, bindingNames } = getForBindingInfo(pattern);
    const evaluatedIterable = await iterableToNode(iterable).eval(context);
    let counter = 1;
    let output = '';
    for await (const [value, key] of resolveEntries(evaluatedIterable, context)) {
      const iterationRules = await createForIterationSurface(
        originalRules,
        context,
        bindingDecls,
        bindingNames,
        value,
        key,
        counter
      );
      counter++;
      output += await iterationRules.render(context, buffer, options);
    }
    return output;
  }

  override render(context: Context, buffer: RenderBuffer, options?: PrintOptions): MaybePromise<string>;
  override render(context: Context, options?: PrintOptions): string;
  override render(context: Context, bufferOrOptions?: RenderBuffer | PrintOptions, options?: PrintOptions): string | MaybePromise<string> {
    if (isRenderBuffer(bufferOrOptions)) {
      return this.renderIterations(context, bufferOrOptions, options);
    }
    return renderControlToString(buffer => this.renderIterations(context, buffer, bufferOrOptions));
  }
}

export type WhileValue = {
  condition: Node;
  rules: Node[];
};

/**
 * `$while (<condition>) { ... }`
 */
export class While extends Rules<WhileValue> {
  static override childKeys = ['condition', 'rules'] as const;

  readonly condition: Node;
  declare readonly rules: Node[];

  override allowRoot = true;
  override allowRuleRoot = true;

  constructor(value: WhileValue, options?: NodeOptions, location?: NodeLocation, treeContext?: Context['treeContext']) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- NodeLocation is LocationInfo | []; parsers always pass a full 6-element tuple or undefined.
    super(normalizeRulesBody('While', value.rules), options, location as LocationInfo | undefined, treeContext);
    this.condition = value.condition;
    this.addFlags(F_VISIBLE, F_NON_STATIC, F_MAY_ASYNC);
    this.adopt(this.condition);
    makeDirectiveRulesPublic(this);
    // R2 single-frame: the While IS its own body (no `_passedRulesWrapper`) — own the
    // body children so per-iteration thin surfaces recognize them as reused.
    ownControlBodyChildren(this);
  }

  override toTrimmedString(rawOptions?: PrintOptions): string {
    const options = getPrintOptions(rawOptions);
    const w = options.writer!;
    const position = w.position();
    this.writeSyntax(options);
    return w.getSince(position);
  }

  /** @internal */
  override writeSyntax(options: FinalPrintOptions): void {
    const w = options.writer;
    w.add('$while (', this);
    this.condition.writeSyntax(options);
    w.add(') ');
    this.writeBraced(options);
  }

  override evalNode(context: Context): MaybePromise<Rules> {
    const run = async (): Promise<Rules> => {
      const outputRules: Node[] = [];
      const originalRules = this;
      const stateRules = createWhileStateSurface(originalRules, context);
      let iterations = 0;
      await runWithRulesContext(context, stateRules, async () => {
        while (true) {
          let conditionPasses: boolean;
          if (this.condition instanceof Condition) {
            conditionPasses = await this.condition.evaluateBoolean(context);
          } else {
            const condition = await this.condition.eval(context);
            conditionPasses = condition instanceof Bool && condition.value === true;
          }
          if (!conditionPasses) {
            break;
          }
          iterations++;
          if (iterations > MAX_WHILE_ITERATIONS) {
            throwWhileIterationLimitExceeded();
          }
          const iterationRules = createWhileIterationSurface(originalRules, stateRules);
          const result = await iterationRules.eval(context);
          if (isNode(result, N.Rules)) {
            await syncWhileState(stateRules, result, context);
            result.scopeFrame = undefined;
            outputRules.push(result);
          } else {
            await syncWhileState(stateRules, iterationRules, context);
            outputRules.push(result);
          }
        }
      });
      if (outputRules.length === 0) {
        return createGeneratedOutputRulesSurface();
      }
      if (outputRules.length === 1) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- single iteration result; control-flow confirms it was pushed as a Rules or Node that behaves as Rules.
        return outputRules[0]! as Rules;
      }
      return createGeneratedOutputRulesSurface(outputRules);
    };
    return run();
  }

  private async renderIterations(
    context: Context,
    buffer: RenderBuffer,
    options?: PrintOptions
  ): Promise<string> {
    const originalRules = this;
    const stateRules = createWhileStateSurface(originalRules, context);
    let iterations = 0;
    let output = '';
    await runWithRulesContext(context, stateRules, async () => {
      while (true) {
        let conditionPasses: boolean;
        if (this.condition instanceof Condition) {
          conditionPasses = await this.condition.evaluateBoolean(context);
        } else {
          const condition = await this.condition.eval(context);
          conditionPasses = condition instanceof Bool && condition.value === true;
        }
        if (!conditionPasses) {
          break;
        }
        iterations++;
        if (iterations > MAX_WHILE_ITERATIONS) {
          throwWhileIterationLimitExceeded();
        }
        let iterationRules = createWhileIterationSurface(originalRules, stateRules);
        if (hasIterationStateMutation(originalRules)) {
          // Source-order EVAL (not prepareRegistration): a self-referential state
          // vardecl (`i: i + 1`) must resolve its RHS `@i` to the incoming state
          // (live slot) BEFORE the decl registers, matching evalNode.
          const evaluated = await iterationRules.eval(context);
          if (!(evaluated instanceof Rules)) {
            throwInvalidWhileIterationRegistrationPrep();
          }
          await syncWhileState(stateRules, evaluated, context);
          iterationRules = evaluated;
        }
        output += await iterationRules.render(context, buffer, options);
      }
    });
    return output;
  }

  override render(context: Context, buffer: RenderBuffer, options?: PrintOptions): MaybePromise<string>;
  override render(context: Context, options?: PrintOptions): string;
  override render(context: Context, bufferOrOptions?: RenderBuffer | PrintOptions, options?: PrintOptions): string | MaybePromise<string> {
    if (isRenderBuffer(bufferOrOptions)) {
      return this.renderIterations(context, bufferOrOptions, options);
    }
    return renderControlToString(buffer => this.renderIterations(context, buffer, bufferOrOptions));
  }

  override resolve(context: Context): MaybePromise<Node> {
    return this.evalNode(context);
  }
}

export const ifNode = defineType(If, 'If', 'if');
export const forNode = defineType(For, 'For', 'for');
export const whileNode = defineType(While, 'While', 'while');
