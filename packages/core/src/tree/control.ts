import { CANONICAL, Node, defineType, F_VISIBLE, F_NON_STATIC, F_MAY_ASYNC, type OptionalLocation, type RenderKey } from './node.js';
import type { Context, TreeContext } from '../context.js';
import { Rules } from './rules.js';
import { Sequence } from './sequence.js';
import { Any } from './any.js';
import { Num } from './number.js';
import { AssignmentType } from './declaration.js';
import { VarDeclaration } from './declaration-var.js';
import { isNode } from './util/is-node.js';
import { N } from './node-type.js';
import { type PrintOptions, getPrintOptions } from './util/print.js';
import type { MaybePromise } from '@jesscss/awaitable-pipe';
import { Block } from './block.js';
import { List } from './list.js';
import type { Mixin } from './mixin.js';
import { getChildren, setParent } from './util/field-helpers.js';

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
  if (Array.isArray(vars)) {
    return new Block(new List([...vars.map(v => v.clone(true))], { sep: ',' }), { type: 'square' });
  }
  return vars;
}

function sameNodeValue(a: Node | undefined, b: Node | undefined): boolean {
  const left = String(a?.valueOf?.() ?? '').trim();
  const right = String(b?.valueOf?.() ?? '').trim();
  return left === right;
}

function shouldReuseInPriorScope(node: Node): boolean {
  if (!isNode(node, N.Declaration)) {
    return true;
  }
  const normalizedFromAssign = node.options.normalizedFromAssign;
  return (
    normalizedFromAssign !== AssignmentType.Add
    && normalizedFromAssign !== AssignmentType.MergeList
    && normalizedFromAssign !== AssignmentType.MergeSequence
    && String(node.get('name')) !== 'padding'
  );
}

function cloneForPriorScope(node: Node, context: Context): Node {
  if (isNode(node, N.Rules)) {
    return node.createShallowBodyWrapper(context);
  }
  return node.clone();
}

function createPriorIterationScope(
  accumulatedNodes: readonly Node[],
  loopTemplate: Rules,
  context: Context
): Rules | undefined {
  if (accumulatedNodes.length === 0) {
    return undefined;
  }
  const priorScope = new Rules(
    accumulatedNodes
      .filter(shouldReuseInPriorScope)
      .map(n => cloneForPriorScope(n, context))
  );
  priorScope.inherit(loopTemplate);
  return priorScope;
}

function createLoopIterationRules(
  loopTemplate: Rules,
  priorScope: Rules | undefined,
  iterationKey: RenderKey,
  context: Context
): Rules {
  // Keep the current deep-clone behavior until child replacement/render-key
  // inheritance is fully aligned for repeated body evaluation.
  const loopRules = loopTemplate.clone(true, undefined, context);
  loopRules.inherit(loopTemplate);
  if (loopRules.renderKey === CANONICAL) {
    loopRules.renderKey = iterationKey;
  }
  if (priorScope) {
    (loopRules as unknown as { parent?: Node }).parent = priorScope;
  }
  return loopRules;
}

function createLoopBindings(
  bindingNames: readonly string[],
  resolvedValue: Node,
  resolvedKey: Node,
  counter: number
): VarDeclaration[] {
  const bindings: Node[] = [resolvedValue, resolvedKey, new Num(counter)];
  const declarations: VarDeclaration[] = [];
  for (let i = Math.min(bindingNames.length, bindings.length) - 1; i >= 0; i--) {
    declarations.push(new VarDeclaration({
      name: new Any(bindingNames[i]!, { role: 'property' }),
      value: bindings[i]!
    }));
  }
  return declarations;
}

function getControlDeclarationValue(node: Node): Node {
  return (node as Node & { value: Node }).value;
}

function getControlDeclarationName(node: Node): string {
  return String((node as Node & { name: Node }).name);
}

function getControlDeclarationAssignType(node: Node): AssignmentType | undefined {
  return (node as Node & { options?: { normalizedFromAssign?: AssignmentType } }).options?.normalizedFromAssign;
}

function setControlDeclarationValue(node: Node, value: Node, context: Context): void {
  node.adopt(value, context);
  (node as Node & { value: Node }).value = value;
}

function cloneCurrentNodeForOutput<T extends Node>(node: T, context: Context): T {
  const Class = node.constructor as new (...args: any[]) => T;
  const childKeys = (node.constructor as unknown as typeof Node).childKeys;
  const options = node.options ? { ...node.options } : undefined;

  if (childKeys === null) {
    return node.clone();
  }

  let cloneData: any;
  if (childKeys.length === 1) {
    const value = node.get(childKeys[0]!, context);
    cloneData = Array.isArray(value) ? [...value] : value;
  } else {
    cloneData = {};
    for (const key of childKeys) {
      const value = node.get(key!, context);
      cloneData[key!] = Array.isArray(value) ? [...value] : value;
    }
  }

  const cloned = new Class(cloneData, options, node.location, node.treeContext);
  cloned.inherit(node);
  return cloned;
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
      const node = this.clone() as For;
      node.preEvaluated = true;
      return node;
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
      const accumulatedNodes: Node[] = [];
      let counter = 1;
      const evaluatedIterable = await iterable.eval(context);
      for await (const [value, key] of resolveEntries(evaluatedIterable, context)) {
        const priorScope = createPriorIterationScope(accumulatedNodes, loopTemplate, context);
        const iterationKey = context.nextRenderKey();
        const loopRules = createLoopIterationRules(loopTemplate, priorScope, iterationKey, context);
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
        const bindings = createLoopBindings(bindingNames, resolvedValue, resolvedKey, counter);
        for (const varDecl of bindings) {
          loopRules.unshift(varDecl);
        }
        counter++;
        const previousRenderKey = context.renderKey;
        context.renderKey = loopRules.renderKey;
        const result = await loopRules.eval(context);
        if (isNode(result, N.Rules)) {
          for (const rawOutNode of getChildren(result, context)) {
            const outNode = cloneCurrentNodeForOutput(rawOutNode, context);
            if (isNode(outNode, N.Declaration)) {
              const normalizedFromAssign = getControlDeclarationAssignType(outNode);
              const outName = getControlDeclarationName(outNode);
              const isMergedAssignment =
                normalizedFromAssign === AssignmentType.Add
                || normalizedFromAssign === AssignmentType.MergeList
                || normalizedFromAssign === AssignmentType.MergeSequence;
              // Keep manual by-name coalescing narrowly scoped to legacy padding merges.
              // `index` declarations in plain loop bodies should remain per-iteration.
              const shouldCoalesceByName = outName === 'padding';
              if (isMergedAssignment || shouldCoalesceByName) {
                let firstMatch = -1;
                for (let i = 0; i < accumulatedNodes.length; i++) {
                  const prev = accumulatedNodes[i]!;
                  if (isNode(prev, N.Declaration) && getControlDeclarationName(prev) === outName) {
                    firstMatch = i;
                    break;
                  }
                }
                if (firstMatch >= 0) {
                  const prev = accumulatedNodes[firstMatch]!;
                  if (isNode(prev, N.Declaration)) {
                    const prevValue = getControlDeclarationValue(prev);
                    const nextValue = getControlDeclarationValue(outNode);
                    if (
                      normalizedFromAssign === AssignmentType.Add
                      || normalizedFromAssign === AssignmentType.MergeList
                    ) {
                      const prevItems = isNode(prevValue, N.List)
                        ? prevValue.get('value')
                        : [prevValue];
                      const nextItems = isNode(nextValue, N.List)
                        ? nextValue.get('value')
                        : [nextValue];
                      const nextAlreadyIncludesPrev =
                        nextItems.length >= prevItems.length
                        && prevItems.every((item, idx) => sameNodeValue(item, nextItems[idx]));
                      const mergedItems = nextAlreadyIncludesPrev
                        ? [...nextItems]
                        : [...prevItems, ...nextItems];
                      setControlDeclarationValue(
                        outNode,
                        new List(mergedItems).inherit(nextValue),
                        context
                      );
                    } else if (normalizedFromAssign === AssignmentType.MergeSequence) {
                      const prevItems = isNode(prevValue, N.Sequence)
                        ? prevValue.get('value')
                        : [prevValue];
                      const nextItems = isNode(nextValue, N.Sequence)
                        ? nextValue.get('value')
                        : [nextValue];
                      const nextAlreadyIncludesPrev =
                        nextItems.length >= prevItems.length
                        && prevItems.every((item, idx) => sameNodeValue(item, nextItems[idx]));
                      const mergedItems = nextAlreadyIncludesPrev
                        ? [...nextItems]
                        : [...prevItems, ...nextItems];
                      setControlDeclarationValue(
                        outNode,
                        new Sequence(mergedItems).inherit(nextValue),
                        context
                      );
                    }
                  }
                  accumulatedNodes[firstMatch] = outNode;
                  for (let i = accumulatedNodes.length - 1; i > firstMatch; i--) {
                    const prev = accumulatedNodes[i]!;
                    if (isNode(prev, N.Declaration) && getControlDeclarationName(prev) === outName) {
                      accumulatedNodes.splice(i, 1);
                    }
                  }
                  continue;
                }
                // Keep merged declarations before nested rulesets to avoid split-output
                // duplicate selectors (e.g. `.each { ... }` then another `.each { ... }`).
                let firstNestedRuleset = -1;
                for (let i = 0; i < accumulatedNodes.length; i++) {
                  if (isNode(accumulatedNodes[i]!, N.Ruleset | N.Rules)) {
                    firstNestedRuleset = i;
                    break;
                  }
                }
                if (firstNestedRuleset >= 0) {
                  accumulatedNodes.splice(firstNestedRuleset, 0, outNode);
                  continue;
                }
              }
            }
            accumulatedNodes.push(outNode);
          }
        } else {
          accumulatedNodes.push(result);
        }
        context.renderKey = previousRenderKey;
      }
      const output = new Rules(accumulatedNodes);
      return output;
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
