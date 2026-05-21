import { Node, defineType, F_VISIBLE, F_NON_STATIC, F_MAY_ASYNC, type NodeLocation, type NodeOptions } from './node.js';
import type { Context, TreeContext } from '../context.js';
import { Rules } from './rules.js';
import { Any } from './any.js';
import { Num } from './number.js';
import { Bool } from './bool.js';

import { VarDeclaration } from './declaration-var.js';
import { isNode } from './util/is-node.js';
import { N } from './node-type.js';
import { type PrintOptions, getPrintOptions } from './util/print.js';
import type { MaybePromise } from '@jesscss/awaitable-pipe';
import { Range } from './range.js';
import { buildScopeFrame, type BindingCell, type ScopeFrame } from './scope-frame.js';
import {
  createRenderBuffer,
  isRenderBuffer,
  renderChosenOutput,
  type RenderBuffer
} from './util/render-buffer.js';

const PUBLIC_RULE_VISIBILITY = {
  Declaration: 'public',
  Ruleset: 'public',
  VarDeclaration: 'public',
  Mixin: 'public'
} as const;
const MAX_WHILE_ITERATIONS = 10000;

function makeDirectiveRulesPublic(rules: Rules) {
  rules.options.rulesVisibility = {
    ...rules.options.rulesVisibility,
    ...PUBLIC_RULE_VISIBILITY
  };
}

function createDerivedIterationOutputSurface(sourceRules: Rules, childNodes?: Node[]): Rules {
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
    sourceRules.treeContext
  ).inherit(sourceRules);
  if (sourceRules.functionRegistry) {
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

function renderIterationRules(
  iterationRules: Rules,
  context: Context,
  buffer: RenderBuffer,
  options?: PrintOptions
): MaybePromise<string> {
  return iterationRules.render(context, buffer, options);
}

function deriveIterationChild(node: Node): Node {
  node.frozen = true;
  return node;
}

function createIterationEvalSurface(sourceRules: Rules): Rules {
  const iterationRules = createDerivedIterationOutputSurface(
    sourceRules,
    sourceRules.value.map(deriveIterationChild)
  );
  iterationRules.options.rulesVisibility = {
    ...iterationRules.options.rulesVisibility,
    ...PUBLIC_RULE_VISIBILITY
  };
  return iterationRules;
}

function createWhileStateSurface(sourceRules: Rules, context: Context): Rules {
  const stateRules = createDerivedIterationOutputSurface(sourceRules);
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
    const value = await last.cell.value.eval(context);
    stateFrame.liveSlotsByName.set(name, {
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
  if ((isNode(input, N.Sequence) || isNode(input, N.List)) && Array.isArray(input.value)) {
    for (let key = 0; key < input.value.length; key++) {
      const value = input.value[key]!;
      yield [value, key];
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
      yield [rule.value.value, rule.value.name];
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
      yield [rule.value.value, rule.value.name];
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
    bindingNames: bindingDecls.map(entry => entry.value.name.valueOf())
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
  return iterationRules;
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

  constructor(value: IfValue, options?: NodeOptions, location?: NodeLocation, treeContext?: TreeContext) {
    super(value, options, location, treeContext);
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

    const [first, ...rest] = this.value.branches;
    w.add('$if', this);
    w.add(' (');
    first?.condition?.toString(options);
    w.add(') ');
    first?.rules.toBraced(options);

    for (const br of rest) {
      if (br.condition) {
        w.add(' $else if (');
        br.condition.toString(options);
        w.add(') ');
      } else {
        w.add(' $else ');
      }
      br.rules.toBraced(options);
    }

    return w.getSince(mark);
  }

  override evalNode(context: Context): MaybePromise<Node> {
    const run = async (): Promise<Node> => {
      for (const branch of this.value.branches) {
        if (!branch.condition) {
          return branch.rules.eval(context);
        }
        const condition = await branch.condition.eval(context);
        if (condition instanceof Bool && condition.value === true) {
          return branch.rules.eval(context);
        }
      }
      return new Rules([]).inherit(this);
    };
    return run();
  }

  private async renderSelectedBranch(
    context: Context,
    buffer: RenderBuffer,
    options?: PrintOptions
  ): Promise<string> {
    for (const branch of this.value.branches) {
      if (!branch.condition) {
        return renderChosenOutput(context, branch.rules.eval(context), buffer, options);
      }
      const condition = await branch.condition.eval(context);
      if (condition instanceof Bool && condition.value === true) {
        return renderChosenOutput(context, branch.rules.eval(context), buffer, options);
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

  constructor(value: StructuredLoopValue, options?: NodeOptions, location?: NodeLocation, treeContext?: TreeContext) {
    super(value, options, location, treeContext);
    this.addFlags(F_VISIBLE, F_NON_STATIC, F_MAY_ASYNC);
    for (const decl of getBindingDeclarations(value.pattern)) {
      this.adopt(decl);
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

  override evalNode(context: Context): MaybePromise<Node> {
    const { pattern, iterable } = this.value;
    const { bindingDecls, bindingNames } = getForBindingInfo(pattern);
    const run = async (): Promise<Node> => {
      const outputRules: Node[] = [];
      let counter = 1;
      const originalRules = this.value.rules;
      const evaluatedIterable = await iterableToNode(iterable).eval(context);
      const preparedOriginalRules = await originalRules.prepareRegistration(context);
      for await (const [value, key] of resolveEntries(evaluatedIterable, context)) {
        const iterationRules = await createForIterationSurface(
          preparedOriginalRules,
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
        return createDerivedIterationOutputSurface(preparedOriginalRules);
      }
      if (outputRules.length === 1) {
        return outputRules[0]!;
      }
      return createDerivedIterationOutputSurface(preparedOriginalRules, outputRules);
    };
    return run();
  }

  override resolve(context: Context): MaybePromise<Node> {
    return this.evalNode(context);
  }

  override toTrimmedString(options?: PrintOptions): string {
    options = getPrintOptions(options);
    const w = options.writer!;
    const mark = w.mark();
    const emitTrimmed = (node: Node) => {
      const saved = options.suppressBoundaryTrivia;
      options.suppressBoundaryTrivia = 'pre';
      try {
        node.toString(options);
      } finally {
        options.suppressBoundaryTrivia = saved;
      }
    };

    w.add('$for ', this);
    w.add('(');
    if (this.value.pattern.kind === 'single') {
      this.value.pattern.value.toString(options);
    } else {
      w.add('[');
      const values = this.value.pattern.values;
      for (let i = 0; i < values.length; i++) {
        values[i]!.toString(options);
        if (i < values.length - 1) {
          w.add(', ');
        }
      }
      w.add(']');
    }
    w.add(' of ');
    if (this.value.iterable.kind === 'node') {
      this.value.iterable.value.toString(options);
    } else {
      emitTrimmed(this.value.iterable.start);
      if (!this.value.iterable.includeStart) {
        w.add('>');
      }
      w.add(' to ');
      if (!this.value.iterable.includeEnd) {
        w.add('<');
      }
      emitTrimmed(this.value.iterable.end);
      if (this.value.iterable.step) {
        w.add(' step ');
        emitTrimmed(this.value.iterable.step);
      }
    }
    w.add(')');
    w.add(' ');
    this.value.rules.toBraced(options);
    return w.getSince(mark);
  }

  private async renderIterations(
    context: Context,
    buffer: RenderBuffer,
    options?: PrintOptions
  ): Promise<string> {
    const { pattern, iterable, rules: originalRules } = this.value;
    const { bindingDecls, bindingNames } = getForBindingInfo(pattern);
    const evaluatedIterable = await iterableToNode(iterable).eval(context);
    const preparedOriginalRules = await originalRules.prepareRegistration(context);
    let counter = 1;
    let output = '';
    for await (const [value, key] of resolveEntries(evaluatedIterable, context)) {
      const iterationRules = await createForIterationSurface(
        preparedOriginalRules,
        context,
        bindingDecls,
        bindingNames,
        value,
        key,
        counter
      );
      counter++;
      output += await renderIterationRules(iterationRules, context, buffer, options);
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

  constructor(value: WhileValue, options?: NodeOptions, location?: NodeLocation, treeContext?: TreeContext) {
    super(value, options, location, treeContext);
    this.addFlags(F_VISIBLE, F_NON_STATIC, F_MAY_ASYNC);
    this.adopt(value.condition);
    this.adopt(value.rules);
    makeDirectiveRulesPublic(value.rules);
  }

  override toTrimmedString(options?: PrintOptions): string {
    options = getPrintOptions(options);
    const w = options.writer!;
    const mark = w.mark();
    w.add('$while (', this);
    this.value.condition.toString(options);
    w.add(') ');
    this.value.rules.toBraced(options);
    return w.getSince(mark);
  }

  override evalNode(context: Context): MaybePromise<Node> {
    const run = async (): Promise<Node> => {
      const outputRules: Node[] = [];
      const originalRules = this.value.rules;
      const stateRules = createWhileStateSurface(originalRules, context);
      const savedRulesContext = context.rulesContext;
      let iterations = 0;
      context.rulesContext = stateRules;
      try {
        while (true) {
          const condition = await this.value.condition.eval(context);
          if (!(condition instanceof Bool && condition.value === true)) {
            break;
          }
          iterations++;
          if (iterations > MAX_WHILE_ITERATIONS) {
            throw new Error(`$while exceeded ${MAX_WHILE_ITERATIONS} iterations`);
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
        return createDerivedIterationOutputSurface(originalRules);
      }
      if (outputRules.length === 1) {
        return outputRules[0]!;
      }
      return createDerivedIterationOutputSurface(originalRules, outputRules);
    };
    return run();
  }

  private async renderIterations(
    context: Context,
    buffer: RenderBuffer,
    options?: PrintOptions
  ): Promise<string> {
    const originalRules = this.value.rules;
    const stateRules = createWhileStateSurface(originalRules, context);
    const savedRulesContext = context.rulesContext;
    let iterations = 0;
    let output = '';
    context.rulesContext = stateRules;
    try {
      while (true) {
        const condition = await this.value.condition.eval(context);
        if (!(condition instanceof Bool && condition.value === true)) {
          break;
        }
        iterations++;
        if (iterations > MAX_WHILE_ITERATIONS) {
          throw new Error(`$while exceeded ${MAX_WHILE_ITERATIONS} iterations`);
        }
        const iterationRules = createWhileIterationSurface(originalRules, stateRules);
        output += await renderIterationRules(iterationRules, context, buffer, options);
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
