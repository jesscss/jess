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
    return vars.map(v => v.name.valueOf());
  }
  return [vars.name.valueOf()];
}

function varsToNode(vars: VarDeclaration | VarDeclaration[]): Node {
  if (Array.isArray(vars)) {
    return new Block(new List([...vars.map(v => v.clone(true))], { sep: ',' }), { type: 'square' });
  }
  return vars;
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
  if (isNode(input, N.Rules | N.Ruleset | N.Mixin)) {
    const rules = isNode(input, N.Rules)
      ? input.value
      : isNode(input, N.Ruleset)
        ? (input.rules?.value ?? [])
        : ((input as Mixin).rules?.value ?? []);
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
  static override childKeys = ['conditions', 'bodies', 'elseBranch'] as const;

  conditions!: Node[];
  bodies!: Rules[];
  elseBranch: Rules | undefined;

  constructor(value: IfValue, options?: any, location?: LocationInfo, treeContext?: TreeContext) {
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

    const { conditions, bodies, elseBranch } = this;
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
  static override childKeys = ['vars', 'iterable', 'rules'] as const;

  vars!: VarDeclaration | VarDeclaration[];
  iterable!: Node;
  rules!: Rules;

  constructor(value: ForValue, options?: any, location?: LocationInfo, treeContext?: TreeContext) {
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
      const node = this.maybeClone(context) as For;
      node.preEvaluated = true;
      return node;
    }
    return this;
  }

  override evalNode(context: Context): MaybePromise<Node> {
    const { vars, iterable } = this;
    const bindingNames = getBindingNames(vars);
    if (bindingNames.length === 0) {
      throw new Error('Invalid $for header: missing binding variable');
    }
    const run = async (): Promise<Node> => {
      const accumulatedNodes: Node[] = [];
      let counter = 1;
      const evaluatedIterable = await iterable.eval(context);
      for await (const [value, key] of resolveEntries(evaluatedIterable, context)) {
        const loopRules = this.rules.clone(true);
        // Preserve definition-scope parent chain so nested calls/lookups
        // inside loop bodies resolve the same way as the original rules.
        loopRules.inherit(this.rules);
        if (accumulatedNodes.length > 0) {
          // Make prior iteration output visible to current iteration lookups
          // (e.g. `index+: @index`, `padding+_: ...`). No copy needed: eval only reads
          // from priorScope and does not mutate prior output.
          const priorScope = new Rules(accumulatedNodes);
          priorScope.inherit(this.rules);
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
          for (const outNode of result.value) {
            if (isNode(outNode, N.Declaration)) {
              const normalizedFromAssign = outNode.options.normalizedFromAssign;
              const outName = String(outNode.name);
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
                  if (isNode(prev, N.Declaration) && String(prev.name) === outName) {
                    firstMatch = i;
                    break;
                  }
                }
                if (firstMatch >= 0) {
                  const prev = accumulatedNodes[firstMatch]!;
                  if (isNode(prev, N.Declaration)) {
                    const prevValue = prev.value;
                    const nextValue = outNode.value;
                    if (
                      normalizedFromAssign === AssignmentType.Add
                      || normalizedFromAssign === AssignmentType.MergeList
                    ) {
                      const prevItems = isNode(prevValue, N.List)
                        ? prevValue.value
                        : [prevValue];
                      const nextItems = isNode(nextValue, N.List)
                        ? nextValue.value
                        : [nextValue];
                      const nextAlreadyIncludesPrev =
                        nextItems.length >= prevItems.length
                        && prevItems.every((item, idx) => String(item.valueOf()) === String(nextItems[idx]?.valueOf()));
                      const mergedItems = nextAlreadyIncludesPrev
                        ? [...nextItems]
                        : [...prevItems, ...nextItems];
                      outNode.setData('value', new List(mergedItems).inherit(outNode.value));
                    } else if (normalizedFromAssign === AssignmentType.MergeSequence) {
                      const prevItems = isNode(prevValue, N.Sequence)
                        ? prevValue.value
                        : [prevValue];
                      const nextItems = isNode(nextValue, N.Sequence)
                        ? nextValue.value
                        : [nextValue];
                      const nextAlreadyIncludesPrev =
                        nextItems.length >= prevItems.length
                        && prevItems.every((item, idx) => String(item.valueOf()) === String(nextItems[idx]?.valueOf()));
                      const mergedItems = nextAlreadyIncludesPrev
                        ? [...nextItems]
                        : [...prevItems, ...nextItems];
                      outNode.setData('value', new Sequence(mergedItems).inherit(outNode.value));
                    }
                  }
                  accumulatedNodes[firstMatch] = outNode;
                  for (let i = accumulatedNodes.length - 1; i > firstMatch; i--) {
                    const prev = accumulatedNodes[i]!;
                    if (isNode(prev, N.Declaration) && String(prev.name) === outName) {
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
    varsToNode(this.vars).toString(options);
    w.add(' of ');
    this.iterable.toString(options);
    w.add(')');
    w.add(' ');
    this.rules.toBraced(options);
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
  static override childKeys = ['header', 'rules'] as const;

  header!: Sequence;
  rules!: Rules;

  constructor(value: LegacyLoopValue, options?: any, location?: LocationInfo, treeContext?: TreeContext) {
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
    w.add('$each ', this);
    this.header.toString(options);
    w.add(' ');
    this.rules.toBraced(options);
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
  static override childKeys = ['condition', 'rules'] as const;

  condition!: Node;
  rules!: Rules;

  constructor(value: WhileValue, options?: any, location?: LocationInfo, treeContext?: TreeContext) {
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
    w.add('$while (', this);
    this.condition.toString(options);
    w.add(') ');
    this.rules.toBraced(options);
    return w.getSince(mark);
  }
}

export const ifNode = defineType(If, 'If', 'if');
export const forNode = defineType(For, 'For', 'for');
export const eachNode = defineType(Each, 'Each', 'each');
export const whileNode = defineType(While, 'While', 'while');
