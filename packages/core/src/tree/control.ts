import { Node, defineType, F_VISIBLE, F_NON_STATIC, F_MAY_ASYNC, type LocationInfo } from './node.js';
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
    return vars.map(v => v.data.name.valueOf());
  }
  return [vars.data.name.valueOf()];
}

function varsToNode(vars: VarDeclaration | VarDeclaration[]): Node {
  if (Array.isArray(vars)) {
    return new Block(new List([...vars.map(v => v.clone(true))], { sep: ',' }), { type: 'square' });
  }
  return vars;
}

async function* resolveEntries(input: Node, context: Context): AsyncGenerator<[Node, number | string | Node]> {
  if (isNode(input, N.Expression)) {
    yield* resolveEntries(await input.data.eval(context), context);
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
  if ((isNode(input, N.Sequence) || isNode(input, N.List)) && Array.isArray(input.data)) {
    for (let key = 0; key < input.data.length; key++) {
      const value = input.data[key]!;
      yield [value, key];
    }
    return;
  }
  if (isNode(input, N.Rules | N.Ruleset | N.Mixin)) {
    const rules = isNode(input, N.Rules)
      ? input.data
      : isNode(input, N.Ruleset)
        ? (input.data.rules?.data ?? [])
        : ((input as Mixin).data.rules?.data ?? []);
    for (const rule of rules) {
      if (!rule || isNode(rule, N.Comment)) {
        continue;
      }
      if (!isNode(rule, N.Declaration)) {
        continue;
      }
      yield [rule.data.value, rule.data.name];
    }
    return;
  }
  yield [input, 0];
}

/** @deprecated Use IfValue directly (conditions/bodies/elseBranch). */
export type IfBranch = {
  condition?: Node;
  rules: Rules;
};

export type IfValue = {
  conditions: Node[];
  bodies: Rules[];
  elseBranch?: Rules;
};

/**
 * A control-flow block that serializes as:
 * - `$if (...) { ... }`
 * - `$else if (...) { ... }`
 * - `$else { ... }`
 *
 * This is language-agnostic: it’s the canonical Jess control node.
 */
export interface If extends Node<IfValue> {
  type: 'If';
  shortType: 'if';
}
export class If extends Node<IfValue> {
  // type = 'If' as const;
  // shortType = 'if' as const;
  override allowRoot = true;
  override allowRuleRoot = true;

  constructor(value: IfValue, options?: any, location?: LocationInfo, treeContext?: TreeContext) {
    super(value, options, location, treeContext);
    this.addFlags(F_VISIBLE, F_NON_STATIC, F_MAY_ASYNC);
    for (const body of value.bodies) {
      makeDirectiveRulesPublic(body);
    }
    if (value.elseBranch) {
      makeDirectiveRulesPublic(value.elseBranch);
    }
  }

  override toTrimmedString(options?: PrintOptions): string {
    options = getPrintOptions(options);
    const w = options.writer!;
    const mark = w.mark();

    const { conditions, bodies, elseBranch } = this.data;
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

export interface For extends Node<ForValue> {
  type: 'For';
  shortType: 'for';
}
/**
 * `$for <header> { ... }`
 */
export class For extends Node<ForValue> {
  // type = 'For' as const;
  // shortType = 'for' as const;
  override allowRoot = true;
  override allowRuleRoot = true;

  constructor(value: ForValue, options?: any, location?: LocationInfo, treeContext?: TreeContext) {
    super(value, options, location, treeContext);
    this.addFlags(F_VISIBLE, F_NON_STATIC, F_MAY_ASYNC);
    makeDirectiveRulesPublic(value.rules);
  }

  override preEval(context: Context): MaybePromise<Node> {
    if (!this.preEvaluated) {
      const node = this.maybeClone(context) as For;
      node.preEvaluated = true;
      return node;
    }
    return this;
  }

  override evalNode(context: Context): MaybePromise<Node> {
    const { vars, iterable } = this.data;
    const bindingNames = getBindingNames(vars);
    if (bindingNames.length === 0) {
      throw new Error('Invalid $for header: missing binding variable');
    }
    const run = async (): Promise<Node> => {
      const accumulatedNodes: Node[] = [];
      let counter = 1;
      const evaluatedIterable = await iterable.eval(context);
      for await (const [value, key] of resolveEntries(evaluatedIterable, context)) {
        const loopRules = this.data.rules.clone(true);
        // Preserve definition-scope parent chain so nested calls/lookups
        // inside loop bodies resolve the same way as the original rules.
        loopRules.inherit(this.data.rules);
        if (accumulatedNodes.length > 0) {
          // Make prior iteration output visible to current iteration lookups
          // (e.g. `index+: @index`, `padding+_: ...`) without mutating emitted nodes.
          const priorScope = new Rules(accumulatedNodes.map(n => n.copy(true)));
          priorScope.inherit(this.data.rules);
          priorScope.adopt(loopRules);
        }
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
        const bindings: Node[] = [resolvedValue, resolvedKey, new Num(counter)];
        for (let i = Math.min(bindingNames.length, bindings.length) - 1; i >= 0; i--) {
          const varDecl = new VarDeclaration({
            name: new Any(bindingNames[i]!, { role: 'property' }),
            value: bindings[i]!
          });
          loopRules.unshift(varDecl);
        }
        counter++;
        const result = await loopRules.eval(context);
        if (isNode(result, N.Rules)) {
          for (const outNode of result.data) {
            if (isNode(outNode, N.Declaration)) {
              const normalizedFromAssign = outNode.options.normalizedFromAssign;
              const outName = String(outNode.data.name);
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
                  if (isNode(prev, N.Declaration) && String(prev.data.name) === outName) {
                    firstMatch = i;
                    break;
                  }
                }
                if (firstMatch >= 0) {
                  const prev = accumulatedNodes[firstMatch]!;
                  if (isNode(prev, N.Declaration)) {
                    const prevValue = prev.data.value;
                    const nextValue = outNode.data.value;
                    if (
                      normalizedFromAssign === AssignmentType.Add
                      || normalizedFromAssign === AssignmentType.MergeList
                    ) {
                      const prevItems = isNode(prevValue, N.List)
                        ? prevValue.data
                        : [prevValue];
                      const nextItems = isNode(nextValue, N.List)
                        ? nextValue.data
                        : [nextValue];
                      const nextAlreadyIncludesPrev =
                        nextItems.length >= prevItems.length
                        && prevItems.every((item, idx) => String(item.valueOf()) === String(nextItems[idx]?.valueOf()));
                      const mergedItems = nextAlreadyIncludesPrev
                        ? [...nextItems]
                        : [...prevItems, ...nextItems];
                      outNode.setData('value', new List(mergedItems).inherit(outNode.data.value));
                    } else if (normalizedFromAssign === AssignmentType.MergeSequence) {
                      const prevItems = isNode(prevValue, N.Sequence)
                        ? prevValue.data
                        : [prevValue];
                      const nextItems = isNode(nextValue, N.Sequence)
                        ? nextValue.data
                        : [nextValue];
                      const nextAlreadyIncludesPrev =
                        nextItems.length >= prevItems.length
                        && prevItems.every((item, idx) => String(item.valueOf()) === String(nextItems[idx]?.valueOf()));
                      const mergedItems = nextAlreadyIncludesPrev
                        ? [...nextItems]
                        : [...prevItems, ...nextItems];
                      outNode.setData('value', new Sequence(mergedItems).inherit(outNode.data.value));
                    }
                  }
                  accumulatedNodes[firstMatch] = outNode;
                  for (let i = accumulatedNodes.length - 1; i > firstMatch; i--) {
                    const prev = accumulatedNodes[i]!;
                    if (isNode(prev, N.Declaration) && String(prev.data.name) === outName) {
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
      }
      return new Rules(accumulatedNodes);
    };
    return run();
  }

  override toTrimmedString(options?: PrintOptions): string {
    options = getPrintOptions(options);
    const w = options.writer!;
    const mark = w.mark();
    w.add('$for ', this);
    w.add('(');
    varsToNode(this.data.vars).toString(options);
    w.add(' of ');
    this.data.iterable.toString(options);
    w.add(')');
    w.add(' ');
    this.data.rules.toBraced(options);
    return w.getSince(mark);
  }
}

/**
 * `$each <header> { ... }`
 */
export interface Each extends Node<LegacyLoopValue> {
  type: 'Each';
  shortType: 'each';
}
export class Each extends Node<LegacyLoopValue> {
  // type = 'Each' as const;
  // shortType = 'each' as const;
  override allowRoot = true;
  override allowRuleRoot = true;

  constructor(value: LegacyLoopValue, options?: any, location?: LocationInfo, treeContext?: TreeContext) {
    super(value, options, location, treeContext);
    this.addFlags(F_VISIBLE, F_NON_STATIC, F_MAY_ASYNC);
  }

  override toTrimmedString(options?: PrintOptions): string {
    options = getPrintOptions(options);
    const w = options.writer!;
    const mark = w.mark();
    w.add('$each ', this);
    this.data.header.toString(options);
    w.add(' ');
    this.data.rules.toBraced(options);
    return w.getSince(mark);
  }
}

export type WhileValue = {
  condition: Node;
  rules: Rules;
};

/**
 * `$while (<condition>) { ... }`
 */
export interface While {
  type: 'While';
  shortType: 'while';
}
export class While extends Node<WhileValue> {
  override allowRoot = true;
  override allowRuleRoot = true;

  constructor(value: WhileValue, options?: any, location?: LocationInfo, treeContext?: TreeContext) {
    super(value, options, location, treeContext);
    this.addFlags(F_VISIBLE, F_NON_STATIC, F_MAY_ASYNC);
    makeDirectiveRulesPublic(value.rules);
  }

  override toTrimmedString(options?: PrintOptions): string {
    options = getPrintOptions(options);
    const w = options.writer!;
    const mark = w.mark();
    w.add('$while (', this);
    this.data.condition.toString(options);
    w.add(') ');
    this.data.rules.toBraced(options);
    return w.getSince(mark);
  }
}

export const ifNode = defineType(If, 'If', 'if');
export const forNode = defineType(For, 'For', 'for');
export const eachNode = defineType(Each, 'Each', 'each');
export const whileNode = defineType(While, 'While', 'while');
