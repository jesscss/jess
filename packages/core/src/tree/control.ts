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
import { EvalSession } from '../eval-session.js';
import { sessionGetChildren, sessionGetField, sessionPatchField, sessionSetParent } from './util/session-helpers.js';

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
    && String(node.name) !== 'padding'
  );
}

function cloneForPriorScope(node: Node, context: Context): Node {
  if (isNode(node, N.Rules)) {
    return node.cloneLookupSafeShallowWrapper(context);
  }
  return node.clone(false, undefined, context);
}

function getControlField<T>(node: Node, key: string, context: Context | undefined, fallback: T): T {
  if (!context) {
    return fallback;
  }
  const session = context.session;
  if (!session) {
    return sessionGetField<T>(node, key, context);
  }
  if (session.hasField(node, key)) {
    return session.getField(node, key) as T;
  }
  const sourceNode = node.sourceNode;
  if (sourceNode !== node && session.hasField(sourceNode, key)) {
    return session.getField(sourceNode, key) as T;
  }
  return sessionGetField<T>(node, key, context);
}

function getControlDeclarationValue(node: Node, context: Context): Node {
  return sessionGetField<Node>(node, 'value', context);
}

function getControlDeclarationName(node: Node, context: Context): string {
  return String(sessionGetField<Node>(node, 'name', context));
}

function getControlDeclarationAssignType(node: Node, context: Context): AssignmentType | undefined {
  const options = getControlField<{ normalizedFromAssign?: AssignmentType } | undefined>(
    node,
    'options',
    context,
    (node as any).options
  );
  return options?.normalizedFromAssign;
}

function setControlDeclarationValue(node: Node, value: Node, context: Context): void {
  node.adopt(value, context);
  if (context.session && !context.session.resetEvalState) {
    sessionPatchField(node, 'value', value, context);
    return;
  }
  node.setData('value', value);
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
      ? getControlField(input, 'value', context, input.value)
      : isNode(input, N.Ruleset)
        ? (input.rules ? getControlField(input.rules, 'value', context, input.rules.value) : [])
        : ((input as Mixin).rules ? getControlField((input as Mixin).rules, 'value', context, (input as Mixin).rules.value) : []);
    for (const rule of rules) {
      if (!rule || isNode(rule, N.Comment)) {
        continue;
      }
      if (!isNode(rule, N.Declaration)) {
        continue;
      }
      yield [
        getControlField(rule, 'value', context, rule.value),
        getControlField(rule, 'name', context, rule.name)
      ];
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

  private _getConditions(context?: Context): Node[] {
    return getControlField(this, 'conditions', context, this.conditions);
  }

  private _getBodies(context?: Context): Rules[] {
    return getControlField(this, 'bodies', context, this.bodies);
  }

  private _getElseBranch(context?: Context): Rules | undefined {
    return getControlField(this, 'elseBranch', context, this.elseBranch);
  }

  override toTrimmedString(options?: PrintOptions): string {
    options = getPrintOptions(options);
    const w = options.writer!;
    const mark = w.mark();
    const context = options.context;

    const conditions = this._getConditions(context);
    const bodies = this._getBodies(context);
    const elseBranch = this._getElseBranch(context);
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
    if (!this._isPreEvaluated(context)) {
      const node = this.maybeClone(context) as For;
      node._setPreEvaluated(true, context);
      return node;
    }
    return this;
  }

  private _getVars(context?: Context): VarDeclaration | VarDeclaration[] {
    return getControlField(this, 'vars', context, this.vars);
  }

  private _getIterable(context?: Context): Node {
    return getControlField(this, 'iterable', context, this.iterable);
  }

  private _getRules(context?: Context): Rules {
    return getControlField(this, 'rules', context, this.rules);
  }

  override evalNode(context: Context): MaybePromise<Node> {
    const vars = this._getVars(context);
    const iterable = this._getIterable(context);
    const loopTemplate = this._getRules(context);
    const bindingNames = getBindingNames(vars);
    if (bindingNames.length === 0) {
      throw new Error('Invalid $for header: missing binding variable');
    }
    const run = async (): Promise<Node> => {
      const accumulatedNodes: Node[] = [];
      let counter = 1;
      const prevSession = context.session;
      if (!prevSession) {
        context.session = new EvalSession({ resetEvalState: true });
      }
      try {
        const evaluatedIterable = await iterable.eval(context);
        for await (const [value, key] of resolveEntries(evaluatedIterable, context)) {
          const loopRules = loopTemplate.clone(false, undefined, context);
          // Preserve definition-scope parent chain so nested calls/lookups
          // inside loop bodies resolve the same way as the original rules.
          loopRules.inherit(loopTemplate);
          if (accumulatedNodes.length > 0) {
            // Make prior iteration output visible to current iteration lookups
            // (e.g. `index+: @index`, `padding+_: ...`) without mutating emitted nodes.
            const priorScope = new Rules(
              accumulatedNodes
                .filter(shouldReuseInPriorScope)
                .map(n => cloneForPriorScope(n, context))
            );
            priorScope.inherit(loopTemplate);
            sessionSetParent(loopRules, priorScope, context);
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
            loopRules.unshift(context, varDecl);
          }
          counter++;
          const result = await loopRules.eval(context);
          if (isNode(result, N.Rules)) {
            for (const outNode of sessionGetChildren(result, context)) {
              if (isNode(outNode, N.Declaration)) {
                const normalizedFromAssign = getControlDeclarationAssignType(outNode, context);
                const outName = getControlDeclarationName(outNode, context);
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
                    if (isNode(prev, N.Declaration) && getControlDeclarationName(prev, context) === outName) {
                      firstMatch = i;
                      break;
                    }
                  }
                  if (firstMatch >= 0) {
                    const prev = accumulatedNodes[firstMatch]!;
                    if (isNode(prev, N.Declaration)) {
                      const prevValue = getControlDeclarationValue(prev, context);
                      const nextValue = getControlDeclarationValue(outNode, context);
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
                          ? prevValue.value
                          : [prevValue];
                        const nextItems = isNode(nextValue, N.Sequence)
                          ? nextValue.value
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
                      if (isNode(prev, N.Declaration) && getControlDeclarationName(prev, context) === outName) {
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
      } finally {
        context.session = prevSession;
      }
      return new Rules(accumulatedNodes);
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
    varsToNode(this._getVars(context)).toString(options);
    w.add(' of ');
    this._getIterable(context).toString(options);
    w.add(')');
    w.add(' ');
    this._getRules(context).toBraced(options);
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

  private _getHeader(context?: Context): Sequence {
    return getControlField(this, 'header', context, this.header);
  }

  private _getRules(context?: Context): Rules {
    return getControlField(this, 'rules', context, this.rules);
  }

  override toTrimmedString(options?: PrintOptions): string {
    options = getPrintOptions(options);
    const w = options.writer!;
    const mark = w.mark();
    const context = options.context;
    w.add('$each ', this);
    this._getHeader(context).toString(options);
    w.add(' ');
    this._getRules(context).toBraced(options);
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

  private _getCondition(context?: Context): Node {
    return getControlField(this, 'condition', context, this.condition);
  }

  private _getRules(context?: Context): Rules {
    return getControlField(this, 'rules', context, this.rules);
  }

  override toTrimmedString(options?: PrintOptions): string {
    options = getPrintOptions(options);
    const w = options.writer!;
    const mark = w.mark();
    const context = options.context;
    w.add('$while (', this);
    this._getCondition(context).toString(options);
    w.add(') ');
    this._getRules(context).toBraced(options);
    return w.getSince(mark);
  }
}

export const ifNode = defineType(If, 'If', 'if');
export const forNode = defineType(For, 'For', 'for');
export const eachNode = defineType(Each, 'Each', 'each');
export const whileNode = defineType(While, 'While', 'while');
