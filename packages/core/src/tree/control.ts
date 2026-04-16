import { Node, defineType, F_VISIBLE, F_NON_STATIC, F_MAY_ASYNC, type LocationInfo } from './node.js';
import type { Context, TreeContext } from '../context.js';
import { Rules } from './rules.js';
import { Any } from './any.js';
import { Num } from './number.js';

import { VarDeclaration } from './declaration-var.js';
import { isNode } from './util/is-node.js';
import { N } from './node-type.js';
import { type PrintOptions, getPrintOptions } from './util/print.js';
import type { MaybePromise } from '@jesscss/awaitable-pipe';
import { Block } from './block.js';
import { Range } from './range.js';
import { List } from './list.js';
import { buildScopeFrame, type BindingCell, type ScopeFrame } from './scope-frame.js';

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

function getBindingDeclarations(pattern: ForPattern): VarDeclaration[] {
  if (pattern.kind === 'single') {
    return [pattern.value];
  }
  if (pattern.kind === 'tuple') {
    return [...pattern.values];
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
        : input.value.rules?.value ?? [];
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

/**
 * `$for <header> { ... }`
 */
export class For extends Node<StructuredLoopValue> {
  override allowRoot = true;
  override allowRuleRoot = true;

  constructor(value: StructuredLoopValue, options?: any, location?: LocationInfo, treeContext?: TreeContext) {
    super(value, options, location, treeContext);
    this.addFlags(F_VISIBLE, F_NON_STATIC, F_MAY_ASYNC);
    makeDirectiveRulesPublic(value.rules);
  }

  override preEval(_context: Context): MaybePromise<Node> {
    if (!this.preEvaluated) {
      this.preEvaluated = true;
      return this;
    }
    return this;
  }

  override evalNode(context: Context): MaybePromise<Node> {
    const { pattern, iterable } = this.value;
    const bindingDecls = getBindingDeclarations(pattern);
    const bindingNames = bindingDecls.map(entry => entry.value.name.valueOf());
    if (bindingDecls.length === 0) {
      throw new Error('Invalid $for header: missing binding variable');
    }
    const run = async (): Promise<Node> => {
      const outputRules: Node[] = [];
      let counter = 1;
      const originalRules = this.value.rules;
      const evaluatedIterable = await iterableToNode(iterable).eval(context);
      for await (const [value, key] of resolveEntries(evaluatedIterable, context)) {
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

        const iterationRules = Rules.create([], {
          rulesVisibility: {
            ...originalRules.options.rulesVisibility,
            ...PUBLIC_RULE_VISIBILITY
          }
        });
        iterationRules.inherit(originalRules);

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
        for (const child of originalRules.value) {
          iterationRules.push(child);
        }
        counter++;
        const result = await iterationRules.eval(context);

        if (isNode(result, N.Rules)) {
          outputRules.push(result);
        } else {
          outputRules.push(result);
        }
      }
      if (outputRules.length === 0) {
        return Rules.create([]);
      }
      if (outputRules.length === 1) {
        return outputRules[0]!;
      }
      const output = Rules.create([]);
      output.inherit(originalRules);
      for (const r of outputRules) {
        output.push(r);
      }
      return output;
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
export const whileNode = defineType(While, 'While', 'while');
