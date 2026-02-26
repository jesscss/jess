import { Node, defineType, F_VISIBLE, F_NON_STATIC, F_MAY_ASYNC, type LocationInfo } from './node.js';
import type { Context, TreeContext } from '../context.js';
import { Rules } from './rules.js';
import { Sequence } from './sequence.js';
import { Any } from './any.js';
import { Num } from './number.js';
import { VarDeclaration } from './declaration-var.js';
import { isNode } from './util/is-node.js';
import { type PrintOptions, getPrintOptions } from './util/print.js';
import type { MaybePromise } from '@jesscss/awaitable-pipe';

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

type ForParts = {
  pattern: Node;
  iterable: Node;
};

function splitForHeader(header: Sequence): ForParts {
  const headerNode = header.value[0];
  const inner = isNode(headerNode, 'Paren') && headerNode.value
    ? headerNode.value
    : headerNode;
  const sequence = isNode(inner, 'Sequence')
    ? inner.value
    : [inner].filter(Boolean) as Node[];
  const ofIndex = sequence.findIndex(node => isNode(node, 'Any') && node.valueOf() === 'of');
  if (ofIndex <= 0 || ofIndex >= sequence.length - 1) {
    throw new Error('Invalid $for header: expected "<pattern> of <iterable>"');
  }
  const patternParts = sequence.slice(0, ofIndex);
  const iterableParts = sequence.slice(ofIndex + 1);
  const pattern = patternParts.length === 1
    ? patternParts[0]!
    : new Sequence(patternParts);
  const iterable = iterableParts.length === 1
    ? iterableParts[0]!
    : new Sequence(iterableParts);
  return { pattern, iterable };
}

function getBindingNames(pattern: Node): string[] {
  if (isNode(pattern, 'VarDeclaration')) {
    return [pattern.value.name.valueOf()];
  }
  if (isNode(pattern, 'Block') && pattern.options?.type === 'square' && isNode(pattern.value, 'List')) {
    return pattern.value.value
      .filter((entry): entry is VarDeclaration => isNode(entry, 'VarDeclaration'))
      .map(entry => entry.value.name.valueOf());
  }
  if (isNode(pattern, 'List') || isNode(pattern, 'Sequence')) {
    return pattern.value
      .filter((entry): entry is VarDeclaration => isNode(entry, 'VarDeclaration'))
      .map(entry => entry.value.name.valueOf());
  }
  return [];
}

async function* resolveEntries(input: Node, context: Context): AsyncGenerator<[Node, number | string | Node]> {
  if (isNode(input, 'Expression')) {
    yield* resolveEntries(await input.value.eval(context), context);
    return;
  }
  if (isNode(input, 'Call')) {
    yield* resolveEntries(await input.eval(context), context);
    return;
  }
  if ((isNode(input, 'Sequence') || isNode(input, 'List')) && Array.isArray(input.value)) {
    for (let key = 0; key < input.value.length; key++) {
      const value = input.value[key]!;
      yield [value, key];
    }
    return;
  }
  if (isNode(input, ['Rules', 'Ruleset', 'Mixin'])) {
    const rules = isNode(input, 'Rules')
      ? input.value
      : isNode(input, 'Ruleset')
        ? (input.value.rules?.value ?? [])
        : (input.value.rules?.value ?? []);
    for (const rule of rules) {
      if (!rule || isNode(rule, 'Comment')) {
        continue;
      }
      if (!isNode(rule, 'Declaration')) {
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

export type LoopValue = {
  header: Sequence;
  rules: Rules;
};

/**
 * `$for <header> { ... }`
 */
export class For extends Node<LoopValue> {
  type = 'For' as const;
  shortType = 'for' as const;
  override allowRoot = true;
  override allowRuleRoot = true;

  constructor(value: LoopValue, options?: any, location?: LocationInfo, treeContext?: TreeContext) {
    super(value, options, location, treeContext);
    this.addFlags(F_VISIBLE, F_NON_STATIC, F_MAY_ASYNC);
    makeDirectiveRulesPublic(value.rules);
  }

  override evalNode(context: Context): MaybePromise<Node> {
    const { pattern, iterable } = splitForHeader(this.value.header);
    const bindingNames = getBindingNames(pattern);
    if (bindingNames.length === 0) {
      throw new Error('Invalid $for header: missing binding variable');
    }
    const run = async (): Promise<Node> => {
      const accumulatedNodes: Node[] = [];
      let counter = 1;
      for await (const [value, key] of resolveEntries(await iterable.eval(context), context)) {
        const loopRules = this.value.rules.clone(true);
        // Preserve definition-scope parent chain so nested calls/lookups
        // inside loop bodies resolve the same way as the original rules.
        loopRules.inherit(this.value.rules);
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
        if (isNode(result, 'Rules')) {
          accumulatedNodes.push(...result.value);
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
    this.value.header.toString(options);
    w.add(' ');
    this.value.rules.toBraced(options);
    return w.getSince(mark);
  }
}

/**
 * `$each <header> { ... }`
 */
export class Each extends Node<LoopValue> {
  type = 'Each' as const;
  shortType = 'each' as const;
  override allowRoot = true;
  override allowRuleRoot = true;

  constructor(value: LoopValue, options?: any, location?: LocationInfo, treeContext?: TreeContext) {
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
