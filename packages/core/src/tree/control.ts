import { Node, defineType, F_VISIBLE, F_NON_STATIC, F_MAY_ASYNC, type NodeLocation, type NodeOptions } from './node.js';
import type { Context } from '../context.js';
import { Rules } from './rules.js';
import { Any } from './any.js';
import { Num } from './number.js';
import { Bool } from './bool.js';
import { Condition } from './condition.js';

import { VarDeclaration } from './declaration-var.js';
import { isNode } from './util/is-node.js';
import { N } from './node-type.js';
import { OutputWriter, type FinalPrintOptions, type PrintOptions, getPrintOptions } from './util/print.js';
import type { MaybePromise } from '@jesscss/awaitable-pipe';
import { Range } from './range.js';
import {
  buildScopeFrame,
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

const PUBLIC_RULE_VISIBILITY = {
  Declaration: 'public',
  Ruleset: 'public',
  VarDeclaration: 'public',
  Mixin: 'public'
} as const;
const MAX_WHILE_ITERATIONS = 10000;

function getWriterTextSincePosition(writer: OutputWriter, position: number): string {
  const chunks = Reflect.get(writer as object, 'chunks');
  if (!Array.isArray(chunks) || position >= chunks.length) {
    return '';
  }
  let out = '';
  for (let i = position; i < chunks.length; i++) {
    out += chunks[i] ?? '';
  }
  return out;
}

function throwWhileIterationLimitExceeded(): never {
  throw new Error(`$while exceeded ${MAX_WHILE_ITERATIONS} iterations`);
}

function throwInvalidWhileIterationRegistrationPrep(): never {
  throw new TypeError('Expected $while iteration registration prep to return Rules');
}

function makeDirectiveRulesPublic(rules: Rules) {
  rules.options.rulesVisibility = {
    ...rules.options.rulesVisibility,
    ...PUBLIC_RULE_VISIBILITY
  };
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
  rules: Rules,
  context: Context,
  buffer: RenderBuffer,
  options?: PrintOptions
): Promise<string> {
  const out = await Promise.resolve(rules.render(context, buffer, options));
  return trimControlTrailingNewline(buffer, out);
}

function createDerivedIterationRulesSurface(
  sourceRules: Rules,
  childNodes?: Node[]
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
    for (const childNode of childNodes) {
      output.push(childNode);
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
  rulesContext: Rules,
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
  return node.cloneForPlacement();
}

function createIterationEvalSurface(sourceRules: Rules): Rules {
  const iterationRules = createDerivedIterationRulesSurface(
    sourceRules,
    sourceRules.rules.map(deriveIterationChild)
  );
  iterationRules.options.rulesVisibility = {
    ...iterationRules.options.rulesVisibility,
    ...PUBLIC_RULE_VISIBILITY
  };
  return iterationRules;
}

function attachIterationFallbackFrame(
  node: Node,
  frame: ScopeFrame,
  seen = new Set<Node>(),
  includeSelf = false
): void {
  if (seen.has(node)) {
    return;
  }
  seen.add(node);
  if (includeSelf && isNode(node, N.Rules)) {
    const scopeFrame = node.getScopeFrame();
    scopeFrame.fallbackFrame ??= frame;
  }
  for (const child of node.children()) {
    attachIterationFallbackFrame(child, frame, seen, true);
  }
}

function createWhileStateSurface(sourceRules: Rules, context: Context): Rules {
  const stateRules = createDerivedIterationRulesSurface(
    sourceRules
  );
  const parentFrame: ScopeFrame | undefined = isNode(context.rulesContext, N.Rules)
    ? context.rulesContext.getScopeFrame()
    : undefined;
  stateRules.scopeFrame = buildScopeFrame(undefined, stateRules, parentFrame, new Map());
  return stateRules;
}

function createWhileIterationSurface(sourceRules: Rules, stateRules: Rules): Rules {
  const iterationRules = createIterationEvalSurface(sourceRules);
  iterationRules.scopeFrame = buildScopeFrame(undefined, iterationRules, stateRules.getScopeFrame());
  return iterationRules;
}

function hasIterationStateMutation(rules: Rules): boolean {
  return rules.rules.some(node => isNode(node, N.VarDeclaration));
}

function getDirectIterationStateMutations(rules: Rules): VarDeclaration[] | undefined {
  const mutations: VarDeclaration[] = [];
  for (const node of rules.rules) {
    if (!isNode(node, N.VarDeclaration)) {
      continue;
    }
    if (
      node.options?.assign
      || node.options?.setDefined
      || node.options?.throwIfDefined
    ) {
      return undefined;
    }
    mutations.push(node);
  }
  return mutations.length > 0 ? mutations : undefined;
}

async function syncWhileState(
  stateRules: Rules,
  iterationRules: Rules,
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

async function syncDirectWhileStateMutations(
  stateRules: Rules,
  mutations: VarDeclaration[],
  context: Context
): Promise<void> {
  const stateFrame = stateRules.getScopeFrame();
  for (const mutation of mutations) {
    const name = mutation.name instanceof Any
      ? mutation.name
      : await mutation.name.eval(context);
    if (!(name instanceof Any)) {
      throw new TypeError('Expected $while mutation name to resolve to Any');
    }
    setScopeFrameLiveBinding(stateFrame, name.valueOf(), {
      value: await mutation.value.eval(context),
      sourceNode: mutation,
      readonly: mutation.options?.readonly
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
    yield* resolveEntries(await input.node.eval(context), context);
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
    for (let key = 0; key < input.items.length; key++) {
      const value = input.items[key]!;
      yield [value, key];
    }
    return;
  }
  if (isNode(input, N.Sequence)) {
    for (let key = 0; key < input.items.length; key++) {
      const value = input.items[key]!;
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
      yield [rule.value, rule.name];
    }
    return;
  }
  if (isNode(input, N.Ruleset) || isNode(input, N.Mixin)) {
    const rules = input.rules.rules;
    for (const rule of rules) {
      if (!rule || isNode(rule, N.Comment)) {
        continue;
      }
      if (!isNode(rule, N.Declaration)) {
        continue;
      }
      yield [rule.value, rule.name];
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
  originalRules: Rules,
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
  iterationRules.scopeFrame = buildScopeFrame(undefined, iterationRules, parentFrame, liveSlots);
  attachIterationFallbackFrame(iterationRules, iterationRules.scopeFrame);
  return iterationRules.prepareRegistration(context);
}

export type IfBranch = {
  /** Undefined means "else" branch */
  condition?: Node;
  rules: Rules;
};

export type IfValue = {
  branches: IfBranch[];
};

/**
 * A control-flow block that serializes as:
 * - `$if (...) { ... }`
 * - `$else if (...) { ... }`
 * - `$else { ... }`
 *
 * This is language-agnostic: it’s the canonical Jess control node.
 */
export class If extends Node<IfValue> {
  static override childKeys = ['branches'] as const;

  readonly branches: IfBranch[];

  override allowRoot = true;
  override allowRuleRoot = true;

  constructor(value: IfValue, options?: NodeOptions, location?: NodeLocation, treeContext?: Context['treeContext']) {
    super(value, options, location);
    this._treeContext = treeContext;
    this.branches = value.branches;
    this.addFlags(F_VISIBLE, F_NON_STATIC, F_MAY_ASYNC);
    for (const branch of this.branches) {
      if (branch.condition) {
        this.adopt(branch.condition);
      }
      this.adopt(branch.rules);
      makeDirectiveRulesPublic(branch.rules);
    }
  }

  override toTrimmedString(options?: PrintOptions): string {
    options = getPrintOptions(options);
    const w = options.writer!;
    const position = w.position();
    this.writeSyntax(options);
    return getWriterTextSincePosition(w, position);
  }

  /** @internal */
  override writeSyntax(options: FinalPrintOptions): void {
    const w = options.writer;
    const [first, ...rest] = this.branches;
    w.add('$if', this);
    w.add(' (');
    first?.condition?.writeSyntax(options);
    w.add(') ');
    first?.rules.writeBraced(options);

    for (const br of rest) {
      if (br.condition) {
        w.add(' $else if (');
        br.condition.writeSyntax(options);
        w.add(') ');
      } else {
        w.add(' $else ');
      }
      br.rules.writeBraced(options);
    }
  }

  override evalNode(context: Context): MaybePromise<Node> {
    const run = async (): Promise<Node> => {
      for (const branch of this.branches) {
        if (!branch.condition) {
          return branch.rules.eval(context);
        }
        let conditionPasses: boolean;
        if (branch.condition instanceof Condition) {
          conditionPasses = await branch.condition.evaluateBoolean(context);
        } else {
          const condition = await branch.condition.eval(context);
          conditionPasses = condition instanceof Bool && condition.value === true;
        }
        if (conditionPasses) {
          return branch.rules.eval(context);
        }
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
    for (const branch of this.branches) {
      if (!branch.condition) {
        return renderControlRules(branch.rules, context, buffer, options);
      }
      let conditionPasses: boolean;
      if (branch.condition instanceof Condition) {
        conditionPasses = await branch.condition.evaluateBoolean(context);
      } else {
        const condition = await branch.condition.eval(context);
        conditionPasses = condition instanceof Bool && condition.value === true;
      }
      if (conditionPasses) {
        return renderControlRules(branch.rules, context, buffer, options);
      }
    }
    return '';
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
  rules: Rules;
};

/**
 * `$for <header> { ... }`
 */
export class For extends Node<StructuredLoopValue> {
  static override childKeys = ['pattern', 'iterable', 'rules'] as const;

  readonly pattern: ForPattern;
  readonly iterable: ForIterable;
  readonly rules: Rules;

  override allowRoot = true;
  override allowRuleRoot = true;

  constructor(value: StructuredLoopValue, options?: NodeOptions, location?: NodeLocation, treeContext?: Context['treeContext']) {
    super(value, options, location);
    this._treeContext = treeContext;
    this.pattern = value.pattern;
    this.iterable = value.iterable;
    this.rules = value.rules;
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
    this.adopt(this.rules);
    makeDirectiveRulesPublic(this.rules);
  }

  override evalNode(context: Context): MaybePromise<Node> {
    const { pattern, iterable } = this;
    const { bindingDecls, bindingNames } = getForBindingInfo(pattern);
    const run = async (): Promise<Node> => {
      const outputRules: Node[] = [];
      let counter = 1;
      const originalRules = this.rules;
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
        const iterationFrame = iterationRules.getScopeFrame();
        attachIterationFallbackFrame(result, iterationFrame);

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
        return outputRules[0]!;
      }
      return createGeneratedOutputRulesSurface(outputRules);
    };
    return run();
  }

  override resolve(context: Context): MaybePromise<Node> {
    return this.evalNode(context);
  }

  override toTrimmedString(options?: PrintOptions): string {
    options = getPrintOptions(options);
    const w = options.writer!;
    const position = w.position();
    this.writeSyntax(options);
    return getWriterTextSincePosition(w, position);
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
    this.rules.writeBraced(options);
  }

  private async renderIterations(
    context: Context,
    buffer: RenderBuffer,
    options?: PrintOptions
  ): Promise<string> {
    const { pattern, iterable, rules: originalRules } = this;
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
  rules: Rules;
};

/**
 * `$while (<condition>) { ... }`
 */
export class While extends Node<WhileValue> {
  static override childKeys = ['condition', 'rules'] as const;

  readonly condition: Node;
  readonly rules: Rules;

  override allowRoot = true;
  override allowRuleRoot = true;

  constructor(value: WhileValue, options?: NodeOptions, location?: NodeLocation, treeContext?: Context['treeContext']) {
    super(value, options, location);
    this._treeContext = treeContext;
    this.condition = value.condition;
    this.rules = value.rules;
    this.addFlags(F_VISIBLE, F_NON_STATIC, F_MAY_ASYNC);
    this.adopt(this.condition);
    this.adopt(this.rules);
    makeDirectiveRulesPublic(this.rules);
  }

  override toTrimmedString(options?: PrintOptions): string {
    options = getPrintOptions(options);
    const w = options.writer!;
    const position = w.position();
    this.writeSyntax(options);
    return getWriterTextSincePosition(w, position);
  }

  /** @internal */
  override writeSyntax(options: FinalPrintOptions): void {
    const w = options.writer;
    w.add('$while (', this);
    this.condition.writeSyntax(options);
    w.add(') ');
    this.rules.writeBraced(options);
  }

  override evalNode(context: Context): MaybePromise<Node> {
    const run = async (): Promise<Node> => {
      const outputRules: Node[] = [];
      const originalRules = this.rules;
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
        return outputRules[0]!;
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
    const originalRules = this.rules;
    const stateRules = createWhileStateSurface(originalRules, context);
    const directMutations = getDirectIterationStateMutations(originalRules);
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
        if (directMutations) {
          await syncDirectWhileStateMutations(stateRules, directMutations, context);
        } else if (hasIterationStateMutation(originalRules)) {
          const preparedIterationRules = await iterationRules.prepareRegistration(context);
          if (!(preparedIterationRules instanceof Rules)) {
            throwInvalidWhileIterationRegistrationPrep();
          }
          await syncWhileState(stateRules, preparedIterationRules, context);
          iterationRules = preparedIterationRules;
        }
        output += await iterationRules.render(context, buffer, options);
        await syncWhileState(stateRules, iterationRules, context);
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
