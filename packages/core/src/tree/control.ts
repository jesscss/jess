import { Node, defineType, F_VISIBLE, F_NON_STATIC, F_MAY_ASYNC, type OptionalLocation } from './node.js';
import type { Context, TreeContext } from '../context.js';
import { Rules } from './rules.js';
import { Sequence } from './sequence.js';
import { Any } from './any.js';
import { Num } from './number.js';
import { VarDeclaration } from './declaration-var.js';
import { isNode } from './util/is-node.js';
import { N } from './node-type.js';
import { type PrintOptions, getPrintOptions } from './util/print.js';
import type { MaybePromise } from '@jesscss/awaitable-pipe';
import { List } from './list.js';
import type { Mixin } from './mixin.js';
import { appendScopedOutputNodes, createCounterNode, evaluateScopedBodyWithBindings } from './util/scoped-body-eval.js';

const PUBLIC_RULE_VISIBILITY = {
  Declaration: 'public',
  Ruleset: 'public',
  VarDeclaration: 'public',
  Mixin: 'public'
} as const;

function makeDirectiveRulesPublic(rules: Rules) {
  rules.options.rulesVisibility = {
    ...rules.options.rulesVisibility,
    ...PUBLIC_RULE_VISIBILITY
  };
}

type LegacyLoopValue = {
  header: Sequence;
  rules: Rules;
};

export type ForValue = {
  vars: VarDeclaration | VarDeclaration[];
  iterable: Node;
  rules: Rules;
};

function getBindingNames(vars: VarDeclaration | VarDeclaration[]): string[] {
  if (Array.isArray(vars)) {
    return vars.map(v => v.get('name').valueOf());
  }
  return [vars.get('name').valueOf()];
}

function varsToNode(vars: VarDeclaration | VarDeclaration[]): Node {
  if (!Array.isArray(vars)) {
    return vars;
  }
  const wrapper = new List<VarDeclaration>([], { sep: ',' });
  wrapper.value = [...vars];
  return wrapper;
}

async function resolveLoopEntryKey(
  key: number | string | Node,
  counter: number,
  context: Context
): Promise<Node> {
  if (typeof key === 'number') {
    return new Num(key + 1);
  }
  if (typeof key === 'string' && key === 'value') {
    return new Num(counter);
  }
  if (isNode(key)) {
    return await key.eval(context);
  }
  return new Any(String(key), { role: 'property' });
}

async function evaluateForIteration(
  loopTemplate: Rules,
  accumulatedNodes: readonly Node[],
  bindingNames: readonly string[],
  value: Node,
  key: number | string | Node,
  counter: number,
  context: Context
): Promise<Node[]> {
  const resolvedValue = await value.eval(context);
  const resolvedKey = await resolveLoopEntryKey(key, counter, context);
  return evaluateScopedBodyWithBindings(
    loopTemplate,
    accumulatedNodes,
    [
      { name: bindingNames[0]!, value: resolvedValue },
      { name: bindingNames[1] ?? '', value: resolvedKey },
      { name: bindingNames[2] ?? '', value: createCounterNode(counter) }
    ].filter(binding => binding.name),
    context
  );
}

async function evaluateForOutput(
  loopTemplate: Rules,
  bindingNames: readonly string[],
  evaluatedIterable: Node,
  context: Context
): Promise<Rules> {
  const accumulatedNodes: Node[] = [];
  let counter = 1;
  for await (const [value, key] of resolveEntries(evaluatedIterable, context)) {
    const outputNodes = await evaluateForIteration(
      loopTemplate,
      accumulatedNodes,
      bindingNames,
      value,
      key,
      counter,
      context
    );
    counter++;
    appendScopedOutputNodes(accumulatedNodes, outputNodes, context);
  }
  return new Rules(accumulatedNodes);
}

async function* resolveEntries(input: Node, context: Context): AsyncGenerator<[Node, number | string | Node]> {
  if (isNode(input, N.Expression)) {
    yield* resolveEntries(await input.get('value', context).eval(context), context);
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
  if (isNode(input, N.Paren)) {
    const parenValue = input.get('value', context);
    if (parenValue instanceof Node) {
      yield* resolveEntries(parenValue, context);
      return;
    }
  }
  if ((isNode(input, N.Sequence) || isNode(input, N.List))) {
    const items = input.get('value', context);
    if (Array.isArray(items)) {
      for (let key = 0; key < items.length; key++) {
        const value = items[key]!;
        yield [value, key];
      }
      return;
    }
  }
  if (isNode(input, N.Rules | N.Ruleset | N.Mixin)) {
    const rules: readonly Node[] = isNode(input, N.Rules)
      ? input.value
      : isNode(input, N.Ruleset)
        ? (input.getRules(context?.renderKey ?? input.renderKey)?.value ?? [])
        : (((input as Mixin).get('rules')?.value) ?? []);
    for (const rule of rules) {
      if (!rule || isNode(rule, N.Comment)) {
        continue;
      }
      if (!isNode(rule, N.Declaration)) {
        continue;
      }
      yield [
        (rule as Node & { value: Node }).value,
        (rule as Node & { name: Node }).name
      ];
    }
    return;
  }
  yield [input, 0];
}

/** @todo - I don't understand how these are different or why the LLM did this? */
export type IfValue = {
  conditions: Node[];
  bodies: Rules[];
  elseBranch?: Rules;
};

export type IfChildData = {
  conditions: Node[];
  bodies: Rules[];
  elseBranch: Rules | undefined;
};

/**
 * A control-flow block that serializes as:
 * - `$if (...) { ... }`
 * - `$else if (...) { ... }`
 * - `$else { ... }`
 *
 * This is language-agnostic: it's the canonical Jess control node.
 */
export interface If extends Node<IfValue, any, IfChildData> {
  type: 'If';
  shortType: 'if';
}
export class If extends Node<IfValue, any, IfChildData> {
  static override childKeys = ['conditions', 'bodies', 'elseBranch'] as const;

  readonly conditions!: Node[];
  readonly bodies!: Rules[];
  readonly elseBranch: Rules | undefined;

  constructor(value: IfValue, options?: any, location?: OptionalLocation, treeContext?: TreeContext) {
    super(value, options, location, treeContext);
    this.conditions = value.conditions;
    this.bodies = value.bodies;
    this.elseBranch = value.elseBranch;
    for (const cond of this.conditions) {
      if (cond instanceof Node) {
        this.adopt(cond);
      }
    }
    for (const body of this.bodies) {
      if (body instanceof Node) {
        this.adopt(body);
      }
      makeDirectiveRulesPublic(body);
    }
    if (this.elseBranch) {
      if (this.elseBranch instanceof Node) {
        this.adopt(this.elseBranch);
      }
      makeDirectiveRulesPublic(this.elseBranch);
    }
    this.allowRoot = true;
    this.allowRuleRoot = true;
    this.addFlags(F_VISIBLE, F_NON_STATIC, F_MAY_ASYNC);
  }

  override toTrimmedString(options?: PrintOptions): string {
    options = getPrintOptions(options);
    const w = options.writer!;
    const mark = w.mark();
    const context = options.context;

    const conditions = this.get('conditions', context);
    const bodies = this.get('bodies', context);
    const elseBranch = this.get('elseBranch', context);
    w.add('$if', this);
    w.add(' (');
    conditions[0]?.toString(options);
    w.add(') ');
    bodies[0]?.toBraced(options);

    for (let i = 1; i < conditions.length; i++) {
      w.add(' $else if (');
      conditions[i]!.toString(options);
      w.add(') ');
      bodies[i]?.toBraced(options);
    }

    if (elseBranch) {
      w.add(' $else ');
      elseBranch.toBraced(options);
    }

    return w.getSince(mark);
  }
}

export type ForChildData = {
  vars: VarDeclaration | VarDeclaration[];
  iterable: Node;
  rules: Rules;
};

export interface For extends Node<ForValue, any, ForChildData> {
  type: 'For';
  shortType: 'for';
}
/**
 * `$for <header> { ... }`
 */
export class For extends Node<ForValue, any, ForChildData> {
  static override childKeys = ['vars', 'iterable', 'rules'] as const;

  readonly vars!: VarDeclaration | VarDeclaration[];
  readonly iterable!: Node;
  readonly rules!: Rules;

  constructor(value: ForValue, options?: any, location?: OptionalLocation, treeContext?: TreeContext) {
    super(value, options, location, treeContext);
    this.vars = value.vars;
    this.iterable = value.iterable;
    this.rules = value.rules;
    if (Array.isArray(this.vars)) {
      for (const v of this.vars) {
        if (v instanceof Node) {
          this.adopt(v);
        }
      }
    } else if (this.vars instanceof Node) {
      this.adopt(this.vars);
    }
    if (this.iterable instanceof Node) {
      this.adopt(this.iterable);
    }
    if (this.rules instanceof Node) {
      this.adopt(this.rules);
    }
    this.allowRoot = true;
    this.allowRuleRoot = true;
    this.addFlags(F_VISIBLE, F_NON_STATIC, F_MAY_ASYNC);
    makeDirectiveRulesPublic(this.rules);
  }

  override preEval(context: Context): MaybePromise<Node> {
    if (!this.preEvaluated) {
      this.preEvaluated = true;
      const out = this.forEachNode(n => n.preEval(context), context);
      if (out && typeof (out as PromiseLike<unknown>).then === 'function') {
        return (out as Promise<void>).then(() => this);
      }
    }
    return this;
  }

  override evalNode(context: Context): MaybePromise<Node> {
    const vars = this.get('vars', context);
    const iterable = this.get('iterable', context);
    const loopTemplate = this.get('rules', context).withRenderOwner(this, context.renderKey, context);
    const bindingNames = getBindingNames(vars);
    if (bindingNames.length === 0) {
      throw new Error('Invalid $for header: missing binding variable');
    }
    const run = async (): Promise<Node> => {
      const evaluatedIterable = await iterable.eval(context);
      return evaluateForOutput(loopTemplate, bindingNames, evaluatedIterable, context);
    };
    return run();
  }

  override toTrimmedString(options?: PrintOptions): string {
    options = getPrintOptions(options);
    const w = options.writer!;
    const mark = w.mark();
    const context = options.context;
    w.add('$for ', this);
    w.add('(');
    varsToNode(this.get('vars', context)).toString(options);
    w.add(' of ');
    this.get('iterable', context).toString(options);
    w.add(')');
    w.add(' ');
    this.get('rules', context).withRenderOwner(this, context?.renderKey, context).toBraced(options);
    return w.getSince(mark);
  }
}

/**
 * `$each <header> { ... }`
 */
export type EachChildData = {
  header: Sequence;
  rules: Rules;
};

export interface Each extends Node<LegacyLoopValue, any, EachChildData> {
  type: 'Each';
  shortType: 'each';
}
export class Each extends Node<LegacyLoopValue, any, EachChildData> {
  static override childKeys = ['header', 'rules'] as const;

  readonly header!: Sequence;
  readonly rules!: Rules;

  constructor(value: LegacyLoopValue, options?: any, location?: OptionalLocation, treeContext?: TreeContext) {
    super(value, options, location, treeContext);
    this.header = value.header;
    this.rules = value.rules;
    if (this.header instanceof Node) {
      this.adopt(this.header);
    }
    if (this.rules instanceof Node) {
      this.adopt(this.rules);
    }
    this.allowRoot = true;
    this.allowRuleRoot = true;
    this.addFlags(F_VISIBLE, F_NON_STATIC, F_MAY_ASYNC);
  }

  override toTrimmedString(options?: PrintOptions): string {
    options = getPrintOptions(options);
    const w = options.writer!;
    const mark = w.mark();
    const context = options.context;
    w.add('$each ', this);
    this.get('header', context).toString(options);
    w.add(' ');
    this.get('rules', context).withRenderOwner(this, context?.renderKey, context).toBraced(options);
    return w.getSince(mark);
  }
}

export type WhileValue = {
  condition: Node;
  rules: Rules;
};

export type WhileChildData = {
  condition: Node;
  rules: Rules;
};

/**
 * `$while (<condition>) { ... }`
 */
export interface While extends Node<WhileValue, any, WhileChildData> {
  type: 'While';
  shortType: 'while';
}
export class While extends Node<WhileValue, any, WhileChildData> {
  static override childKeys = ['condition', 'rules'] as const;

  readonly condition!: Node;
  readonly rules!: Rules;

  constructor(value: WhileValue, options?: any, location?: OptionalLocation, treeContext?: TreeContext) {
    super(value, options, location, treeContext);
    this.condition = value.condition;
    this.rules = value.rules;
    if (this.condition instanceof Node) {
      this.adopt(this.condition);
    }
    if (this.rules instanceof Node) {
      this.adopt(this.rules);
    }
    this.allowRoot = true;
    this.allowRuleRoot = true;
    this.addFlags(F_VISIBLE, F_NON_STATIC, F_MAY_ASYNC);
    makeDirectiveRulesPublic(this.rules);
  }

  override toTrimmedString(options?: PrintOptions): string {
    options = getPrintOptions(options);
    const w = options.writer!;
    const mark = w.mark();
    const context = options.context;
    w.add('$while (', this);
    this.get('condition', context).toString(options);
    w.add(') ');
    this.get('rules', context).withRenderOwner(this, context?.renderKey, context).toBraced(options);
    return w.getSince(mark);
  }
}

export const ifNode = defineType(If, 'If', 'if');
export const forNode = defineType(For, 'For', 'for');
export const eachNode = defineType(Each, 'Each', 'each');
export const whileNode = defineType(While, 'While', 'while');
