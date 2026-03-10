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
import { Range } from './range.js';
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

type LegacyLoopValue = {
  header: Sequence;
  rules: Rules;
};

function parsePatternNode(patternNode: Node): ForPattern {
  if (isNode(patternNode, N.VarDeclaration)) {
    return { kind: 'single', value: patternNode };
  }
  if (patternNode.type === 'Block' && patternNode.options?.type === 'square' && isNode(patternNode.value, N.List)) {
    const values = patternNode.value.value.filter((entry): entry is VarDeclaration => isNode(entry, N.VarDeclaration));
    if (values.length === 1) {
      return { kind: 'single', value: values[0]! };
    }
    if (values.length > 1) {
      return { kind: 'tuple', values: values as [VarDeclaration, ...VarDeclaration[]] };
    }
  }
  if (isNode(patternNode, N.List | N.Sequence)) {
    const values = (patternNode as List).value.filter((entry): entry is VarDeclaration => isNode(entry, N.VarDeclaration));
    if (values.length === 1) {
      return { kind: 'single', value: values[0]! };
    }
    if (values.length > 1) {
      return { kind: 'tuple', values: values as [VarDeclaration, ...VarDeclaration[]] };
    }
  }
  throw new Error('Invalid $for pattern: expected one or more variables');
}

function parseLegacyHeader(header: Sequence): {
  pattern: ForPattern;
  iterable: ForIterable;
} {
  const headerNode = header.value[0];
  const inner = isNode(headerNode, N.Paren) && headerNode.value
    ? headerNode.value
    : headerNode;
  const sequence = isNode(inner, N.Sequence)
    ? inner.value
    : [inner].filter(Boolean) as Node[];
  const ofIndex = sequence.findIndex(node => isNode(node, N.Any) && node.valueOf() === 'of');
  if (ofIndex <= 0 || ofIndex >= sequence.length - 1) {
    throw new Error('Invalid $for header: expected "<pattern> of <iterable>"');
  }
  const patternParts = sequence.slice(0, ofIndex);
  const iterableParts = sequence.slice(ofIndex + 1);
  const patternNode = patternParts.length === 1
    ? patternParts[0]!
    : new Sequence(patternParts);
  const iterableNode = iterableParts.length === 1
    ? iterableParts[0]!
    : new Sequence(iterableParts);
  let iterable: ForIterable;
  if (isNode(iterableNode, N.Range)) {
    iterable = {
      kind: 'range',
      start: iterableNode.value.start,
      end: iterableNode.value.end,
      step: iterableNode.value.step,
      includeStart: iterableNode.options?.includeStart !== false,
      includeEnd: iterableNode.options?.includeEnd !== false
    };
  } else {
    iterable = { kind: 'node', value: iterableNode };
  }
  return {
    pattern: parsePatternNode(patternNode),
    iterable
  };
}

function getBindingNames(pattern: ForPattern): string[] {
  if (pattern.kind === 'single') {
    return [pattern.value.value.name.valueOf()];
  }
  if (pattern.kind === 'tuple') {
    return pattern.values.map(entry => entry.value.name.valueOf());
  }
  return [];
}

function patternToNode(pattern: ForPattern): Node {
  if (pattern.kind === 'single') {
    return pattern.value;
  }
  return new Block(new List([...pattern.values], { sep: ',' }), { type: 'square' });
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
        ? (input.value.rules?.value ?? [])
        : ((input as Mixin).value.rules?.value ?? []);
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
  type = 'If' as const;
  shortType = 'if' as const;
  override allowRoot = true;
  override allowRuleRoot = true;

  constructor(value: IfValue, options?: any, location?: LocationInfo, treeContext?: TreeContext) {
    super(value, options, location, treeContext);
    this.addFlags(F_VISIBLE, F_NON_STATIC, F_MAY_ASYNC);
    for (const branch of value.branches) {
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
}

export type StructuredLoopValue = {
  pattern: ForPattern;
  iterable: ForIterable;
  rules: Rules;
};

export type LoopValue = StructuredLoopValue | LegacyLoopValue;

/**
 * `$for <header> { ... }`
 */
export class For extends Node<StructuredLoopValue> {
  type = 'For' as const;
  shortType = 'for' as const;
  override allowRoot = true;
  override allowRuleRoot = true;

  constructor(value: LoopValue, options?: any, location?: LocationInfo, treeContext?: TreeContext) {
    const normalized = ('header' in value)
      ? (() => {
          const parsed = parseLegacyHeader(value.header);
          return {
            pattern: parsed.pattern,
            iterable: parsed.iterable,
            rules: value.rules
          };
        })()
      : value;
    super(normalized, options, location, treeContext);
    this.addFlags(F_VISIBLE, F_NON_STATIC, F_MAY_ASYNC);
    makeDirectiveRulesPublic(normalized.rules);
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
    const { pattern, iterable } = this.value;
    const bindingNames = getBindingNames(pattern);
    if (bindingNames.length === 0) {
      throw new Error('Invalid $for header: missing binding variable');
    }
    const run = async (): Promise<Node> => {
      const accumulatedNodes: Node[] = [];
      let counter = 1;
      const evaluatedIterable = await iterableToNode(iterable).eval(context);
      for await (const [value, key] of resolveEntries(evaluatedIterable, context)) {
        const loopRules = this.value.rules.clone(true);
        // Preserve definition-scope parent chain so nested calls/lookups
        // inside loop bodies resolve the same way as the original rules.
        loopRules.inherit(this.value.rules);
        if (accumulatedNodes.length > 0) {
          // Make prior iteration output visible to current iteration lookups
          // (e.g. `index+: @index`, `padding+_: ...`) without mutating emitted nodes.
          const priorScope = new Rules(accumulatedNodes.map(n => n.copy(true)));
          priorScope.inherit(this.value.rules);
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
          loopRules.value.unshift(new VarDeclaration({
            name: new Any(bindingNames[i]!, { role: 'property' }),
            value: bindings[i]!
          }));
        }
        counter++;
        const result = await loopRules.eval(context);
        if (isNode(result, N.Rules)) {
          for (const outNode of result.value) {
            if (isNode(outNode, N.Declaration)) {
              const normalizedFromAssign = outNode.options.normalizedFromAssign;
              const outName = String(outNode.value.name);
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
                  if (isNode(prev, N.Declaration) && String(prev.value.name) === outName) {
                    firstMatch = i;
                    break;
                  }
                }
                if (firstMatch >= 0) {
                  const prev = accumulatedNodes[firstMatch]!;
                  if (isNode(prev, N.Declaration)) {
                    const prevValue = prev.value.value;
                    const nextValue = outNode.value.value;
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
                      outNode.value.value = new List(mergedItems).inherit(outNode.value.value);
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
                      outNode.value.value = new Sequence(mergedItems).inherit(outNode.value.value);
                    }
                  }
                  accumulatedNodes[firstMatch] = outNode;
                  for (let i = accumulatedNodes.length - 1; i > firstMatch; i--) {
                    const prev = accumulatedNodes[i]!;
                    if (isNode(prev, N.Declaration) && String(prev.value.name) === outName) {
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
    patternToNode(this.value.pattern).toString(options);
    w.add(' of ');
    iterableToNode(this.value.iterable).toString(options);
    w.add(')');
    w.add(' ');
    this.value.rules.toBraced(options);
    return w.getSince(mark);
  }
}

/**
 * `$each <header> { ... }`
 */
export class Each extends Node<LegacyLoopValue> {
  type = 'Each' as const;
  shortType = 'each' as const;
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
    this.value.header.toString(options);
    w.add(' ');
    this.value.rules.toBraced(options);
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
export class While extends Node<WhileValue> {
  type = 'While' as const;
  shortType = 'while' as const;
  override allowRoot = true;
  override allowRuleRoot = true;

  constructor(value: WhileValue, options?: any, location?: LocationInfo, treeContext?: TreeContext) {
    super(value, options, location, treeContext);
    this.addFlags(F_VISIBLE, F_NON_STATIC, F_MAY_ASYNC);
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
}

export const ifNode = defineType(If, 'If', 'if');
export const forNode = defineType(For, 'For', 'for');
export const eachNode = defineType(Each, 'Each', 'each');
export const whileNode = defineType(While, 'While', 'while');
