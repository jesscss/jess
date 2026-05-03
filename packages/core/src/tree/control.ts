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
import { Range } from './range.js';
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

function renderControlSourceSyntax(node: Node, context: Context, options?: PrintOptions): string {
  const printOptions = getPrintOptions({ ...options, context });
  const savedContext = printOptions.context;
  printOptions.context = undefined;
  try {
    return node.toTrimmedString(printOptions);
  } finally {
    printOptions.context = savedContext;
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

  override render(context: Context, options?: PrintOptions): string {
    return renderControlSourceSyntax(this, context, options);
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

  private createDerivedIterationOutputSurface(sourceRules: Rules, childNodes?: Node[]): Rules {
    const output = sourceRules.clone(false) as Rules;
    output.value = [];
    output.scopeFrame = undefined;
    if (childNodes) {
      for (const childNode of childNodes) {
        output.push(childNode);
      }
    }
    return output;
  }

  constructor(value: StructuredLoopValue, options?: any, location?: LocationInfo, treeContext?: TreeContext) {
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

        const iterationRules = originalRules.clone(false) as Rules;
        iterationRules.options.rulesVisibility = {
          ...iterationRules.options.rulesVisibility,
          ...PUBLIC_RULE_VISIBILITY
        };

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
        return this.createDerivedIterationOutputSurface(originalRules);
      }
      if (outputRules.length === 1) {
        return outputRules[0]!;
      }
      return this.createDerivedIterationOutputSurface(originalRules, outputRules);
    };
    return run();
  }

  override toTrimmedString(options?: PrintOptions): string {
    options = getPrintOptions(options);
    const w = options.writer!;
    const mark = w.mark();
    const emitTrimmed = (node: Node) => {
      const out = w.capture(() => node.toString(options));
      w.add(out.replace(/^[ \t\r\f]+|[ \t\r\f]+$/g, ''), node);
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

  override render(context: Context, options?: PrintOptions): string {
    return renderControlSourceSyntax(this, context, options);
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

  override render(context: Context, options?: PrintOptions): string {
    return renderControlSourceSyntax(this, context, options);
  }
}

export const ifNode = defineType(If, 'If', 'if');
export const forNode = defineType(For, 'For', 'for');
export const whileNode = defineType(While, 'While', 'while');
