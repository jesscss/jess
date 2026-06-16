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
import { type FinalPrintOptions, type PrintOptions, getPrintOptions } from './util/print.js';
import type { MaybePromise } from '@jesscss/awaitable-pipe';
import { Range } from './range.js';
import { buildScopeFrame, getBindingCellValue, type BindingCell, type ScopeFrame } from './scope-frame.js';
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

function makeDirectiveRulesPublic(rules: Rules) {
  rules.options.rulesVisibility = {
    ...rules.options.rulesVisibility,
    ...PUBLIC_RULE_VISIBILITY
  };
}

async function renderControlRules(
  rules: Rules,
  context: Context,
  buffer: RenderBuffer,
  options?: PrintOptions
): Promise<string> {
  const out = await rules.render(context, buffer, options);
  if (!out.endsWith('\n')) {
    return out;
  }
  if (buffer.kind === 'flat') {
    const index = buffer.parts.length - 1;
    const part = buffer.parts[index];
    if (part?.endsWith('\n')) {
      buffer.parts[index] = part.substring(0, part.length - 1);
    }
  } else {
    const index = buffer.segments.length - 1;
    const segment = buffer.segments[index];
    if (typeof segment === 'string' && segment.endsWith('\n')) {
      buffer.segments[index] = segment.substring(0, segment.length - 1);
    }
  }
  return out.substring(0, out.length - 1);
}

function createDerivedIterationRulesSurface(
  sourceRules: Rules,
  childNodes?: Node[],
  options: {
    preserveFunctionRegistry?: boolean;
  } = {}
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
  if (options.preserveFunctionRegistry === true && sourceRules.functionRegistry) {
    output.functionRegistry = sourceRules.functionRegistry.cloneForRules(output);
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

function createIterationEvalSurface(sourceRules: Rules): Rules {
  const childNodes = new Array<Node>(sourceRules.value.length);
  for (let i = 0; i < sourceRules.value.length; i++) {
    childNodes[i] = copyWithReusableLeaves(sourceRules.value[i]!);
  }
  const iterationRules = createDerivedIterationRulesSurface(
    sourceRules,
    childNodes,
    { preserveFunctionRegistry: true }
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
    sourceRules,
    undefined,
    { preserveFunctionRegistry: true }
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
  for (let i = 0; i < rules.value.length; i++) {
    if (isNode(rules.value[i], N.VarDeclaration)) {
      return true;
    }
  }
  return false;
}

function getDirectIterationStateMutations(rules: Rules): VarDeclaration[] | undefined {
  const mutations: VarDeclaration[] = [];
  for (const node of rules.value) {
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
    stateFrame.liveSlotsByName.set(name, {
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
    const name = mutation.value.name instanceof Any
      ? mutation.value.name
      : await mutation.value.name.eval(context);
    if (!(name instanceof Any)) {
      throw new TypeError('Expected $while mutation name to resolve to Any');
    }
    stateFrame.liveSlotsByName.set(name.valueOf(), {
      value: await mutation.value.value.eval(context),
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

/**
 * Visits each `$for` iterable entry without constructing async-generator state
 * or `[value, key]` tuple arrays for every item.
 */
async function visitResolvedEntries(
  input: Node,
  context: Context,
  visit: (value: Node, key: number | string | Node) => Promise<void>
): Promise<void> {
  if (isNode(input, N.Expression)) {
    await visitResolvedEntries(await input.value.eval(context), context, visit);
    return;
  }
  if (isNode(input, N.Call)) {
    const evald = await input.eval(context);
    if (isNode(evald, N.Call)) {
      await visit(evald, 0);
      return;
    }
    await visitResolvedEntries(evald, context, visit);
    return;
  }
  if ((isNode(input, N.Sequence) || isNode(input, N.List)) && Array.isArray(input.value)) {
    for (let key = 0; key < input.value.length; key++) {
      const value = input.value[key]!;
      await visit(value, key);
    }
    return;
  }
  if (isNode(input, N.Rules)) {
    const rules = input.value;
    for (const rule of rules) {
      if (!rule || isNode(rule, N.Comment)) {
        continue;
      }
      if (!isNode(rule, N.Declaration)) {
        continue;
      }
      await visit(rule.value.value, rule.value.name);
    }
    return;
  }
  if (isNode(input, N.Ruleset) || isNode(input, N.Mixin)) {
    const rules = input.value.rules?.value ?? [];
    for (const rule of rules) {
      if (!rule || isNode(rule, N.Comment)) {
        continue;
      }
      if (!isNode(rule, N.Declaration)) {
        continue;
      }
      await visit(rule.value.value, rule.value.name);
    }
    return;
  }
  await visit(input, 0);
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
  if (pattern.kind === 'single') {
    const value = pattern.value;
    return {
      bindingDecls: [value],
      bindingNames: [value.value.name.valueOf()]
    };
  }
  if (pattern.kind !== 'tuple' || pattern.values.length === 0) {
    throw new Error('Invalid $for header: missing binding variable');
  }
  const bindingDecls = new Array<VarDeclaration>(pattern.values.length);
  const bindingNames = new Array<string>(bindingDecls.length);
  for (let i = 0; i < pattern.values.length; i++) {
    const decl = pattern.values[i]!;
    bindingDecls[i] = decl;
    bindingNames[i] = decl.value.name.valueOf();
  }
  return {
    bindingDecls,
    bindingNames
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
  override allowRoot = true;
  override allowRuleRoot = true;

  constructor(value: IfValue, options?: NodeOptions, location?: NodeLocation) {
    super(value, options, location);
    this.addFlags(F_VISIBLE, F_NON_STATIC, F_MAY_ASYNC);
    for (const branch of value.branches) {
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
    const mark = w.mark();
    this.writeSyntax(options);
    return w.getSince(mark);
  }

  /** @internal */
  override writeSyntax(options: FinalPrintOptions): void {
    const w = options.writer;
    const branches = this.value.branches;
    const first = branches[0];
    w.add('$if', this);
    w.add(' (');
    first?.condition?.writeSyntax(options);
    w.add(') ');
    first?.rules.writeBracedSyntax(options);

    for (let i = 1; i < branches.length; i++) {
      const br = branches[i]!;
      if (br.condition) {
        w.add(' $else if (');
        br.condition.writeSyntax(options);
        w.add(') ');
      } else {
        w.add(' $else ');
      }
      br.rules.writeBracedSyntax(options);
    }
  }

  override async evalNode(context: Context): Promise<Node> {
    for (const branch of this.value.branches) {
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
  }

  private async renderSelectedBranch(
    context: Context,
    buffer: RenderBuffer,
    options?: PrintOptions
  ): Promise<string> {
    for (const branch of this.value.branches) {
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
    return this.renderSelectedBranch(context, createRenderBuffer('flat'), bufferOrOptions);
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
  override allowRoot = true;
  override allowRuleRoot = true;

  constructor(value: StructuredLoopValue, options?: NodeOptions, location?: NodeLocation) {
    super(value, options, location);
    this.addFlags(F_VISIBLE, F_NON_STATIC, F_MAY_ASYNC);
    if (value.pattern.kind === 'single') {
      this.adopt(value.pattern.value);
    } else {
      const values = value.pattern.values;
      for (let i = 0; i < values.length; i++) {
        this.adopt(values[i]!);
      }
    }
    if (value.iterable.kind === 'node') {
      this.adopt(value.iterable.value);
    } else {
      this.adopt(value.iterable.start);
      this.adopt(value.iterable.end);
      if (value.iterable.step) {
        this.adopt(value.iterable.step);
      }
    }
    this.adopt(value.rules);
    makeDirectiveRulesPublic(value.rules);
  }

  override async evalNode(context: Context): Promise<Node> {
    const { pattern, iterable } = this.value;
    const { bindingDecls, bindingNames } = getForBindingInfo(pattern);
    const outputRules: Node[] = [];
    let counter = 1;
    const originalRules = this.value.rules;
    const evaluatedIterable = await iterableToNode(iterable).eval(context);
    await visitResolvedEntries(evaluatedIterable, context, async (value, key) => {
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
      }
      outputRules.push(result);
    });
    if (outputRules.length === 0) {
      return createGeneratedOutputRulesSurface();
    }
    if (outputRules.length === 1) {
      return outputRules[0]!;
    }
    return createGeneratedOutputRulesSurface(outputRules);
  }

  override resolve(context: Context): MaybePromise<Node> {
    return this.evalNode(context);
  }

  override toTrimmedString(options?: PrintOptions): string {
    options = getPrintOptions(options);
    const w = options.writer!;
    const mark = w.mark();
    this.writeSyntax(options);
    return w.getSince(mark);
  }

  /** @internal */
  override writeSyntax(options: FinalPrintOptions): void {
    const w = options.writer;
    w.add('$for ', this);
    w.add('(');
    if (this.value.pattern.kind === 'single') {
      this.value.pattern.value.writeSyntax(options);
    } else {
      w.add('[');
      const values = this.value.pattern.values;
      for (let i = 0; i < values.length; i++) {
        values[i]!.writeSyntax(options);
        if (i < values.length - 1) {
          w.add(', ');
        }
      }
      w.add(']');
    }
    w.add(' of ');
    if (this.value.iterable.kind === 'node') {
      this.value.iterable.value.writeSyntax(options);
    } else {
      this.value.iterable.start.writeSyntax(options);
      if (!this.value.iterable.includeStart) {
        w.add('>');
      }
      w.add(' to ');
      if (!this.value.iterable.includeEnd) {
        w.add('<');
      }
      this.value.iterable.end.writeSyntax(options);
      if (this.value.iterable.step) {
        w.add(' step ');
        this.value.iterable.step.writeSyntax(options);
      }
    }
    w.add(')');
    w.add(' ');
    this.value.rules.writeBracedSyntax(options);
  }

  private async renderIterations(
    context: Context,
    buffer: RenderBuffer,
    options?: PrintOptions
  ): Promise<string> {
    const { pattern, iterable, rules: originalRules } = this.value;
    const { bindingDecls, bindingNames } = getForBindingInfo(pattern);
    const evaluatedIterable = await iterableToNode(iterable).eval(context);
    let counter = 1;
    let output = '';
    await visitResolvedEntries(evaluatedIterable, context, async (value, key) => {
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
    });
    return output;
  }

  override render(context: Context, buffer: RenderBuffer, options?: PrintOptions): MaybePromise<string>;
  override render(context: Context, options?: PrintOptions): string;
  override render(context: Context, bufferOrOptions?: RenderBuffer | PrintOptions, options?: PrintOptions): string | MaybePromise<string> {
    if (isRenderBuffer(bufferOrOptions)) {
      return this.renderIterations(context, bufferOrOptions, options);
    }
    return this.renderIterations(context, createRenderBuffer('flat'), bufferOrOptions);
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
  override allowRoot = true;
  override allowRuleRoot = true;

  constructor(value: WhileValue, options?: NodeOptions, location?: NodeLocation) {
    super(value, options, location);
    this.addFlags(F_VISIBLE, F_NON_STATIC, F_MAY_ASYNC);
    this.adopt(value.condition);
    this.adopt(value.rules);
    makeDirectiveRulesPublic(value.rules);
  }

  override toTrimmedString(options?: PrintOptions): string {
    options = getPrintOptions(options);
    const w = options.writer!;
    const mark = w.mark();
    this.writeSyntax(options);
    return w.getSince(mark);
  }

  /** @internal */
  override writeSyntax(options: FinalPrintOptions): void {
    const w = options.writer;
    w.add('$while (', this);
    this.value.condition.writeSyntax(options);
    w.add(') ');
    this.value.rules.writeBracedSyntax(options);
  }

  override async evalNode(context: Context): Promise<Node> {
    const outputRules: Node[] = [];
    const originalRules = this.value.rules;
    const stateRules = createWhileStateSurface(originalRules, context);
    let iterations = 0;
    const savedRulesContext = context.rulesContext;
    context.rulesContext = stateRules;
    try {
      while (true) {
        let conditionPasses: boolean;
        if (this.value.condition instanceof Condition) {
          conditionPasses = await this.value.condition.evaluateBoolean(context);
        } else {
          const condition = await this.value.condition.eval(context);
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
    } finally {
      context.rulesContext = savedRulesContext;
    }
    if (outputRules.length === 0) {
      return createGeneratedOutputRulesSurface();
    }
    if (outputRules.length === 1) {
      return outputRules[0]!;
    }
    return createGeneratedOutputRulesSurface(outputRules);
  }

  private async renderIterations(
    context: Context,
    buffer: RenderBuffer,
    options?: PrintOptions
  ): Promise<string> {
    const originalRules = this.value.rules;
    const stateRules = createWhileStateSurface(originalRules, context);
    const directMutations = getDirectIterationStateMutations(originalRules);
    let iterations = 0;
    let output = '';
    const savedRulesContext = context.rulesContext;
    context.rulesContext = stateRules;
    try {
      while (true) {
        let conditionPasses: boolean;
        if (this.value.condition instanceof Condition) {
          conditionPasses = await this.value.condition.evaluateBoolean(context);
        } else {
          const condition = await this.value.condition.eval(context);
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
    } finally {
      context.rulesContext = savedRulesContext;
    }
    return output;
  }

  override render(context: Context, buffer: RenderBuffer, options?: PrintOptions): MaybePromise<string>;
  override render(context: Context, options?: PrintOptions): string;
  override render(context: Context, bufferOrOptions?: RenderBuffer | PrintOptions, options?: PrintOptions): string | MaybePromise<string> {
    if (isRenderBuffer(bufferOrOptions)) {
      return this.renderIterations(context, bufferOrOptions, options);
    }
    return this.renderIterations(context, createRenderBuffer('flat'), bufferOrOptions);
  }

  override resolve(context: Context): MaybePromise<Node> {
    return this.evalNode(context);
  }
}

export const ifNode = defineType(If, 'If', 'if');
export const forNode = defineType(For, 'For', 'for');
export const whileNode = defineType(While, 'While', 'while');
