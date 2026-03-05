import { type Context } from '../context.js';
import { F_NON_STATIC, F_VISIBLE, Node, defineType } from './node.js';
import { Bool } from './bool.js';
import { type PrintOptions, getPrintOptions } from './util/print.js';
import { type MaybePromise, pipe, isThenable } from '@jesscss/awaitable-pipe';

/** @note Less will parse =< but it will be stored as <= */
export type ConditionOperator = 'and' | 'or' | '=' | '>' | '<' | '>=' | '<=';

export type ConditionValue = [
  left: Node
] | [
  left: Node,
  op: ConditionOperator,
  right: Node
];

export type ConditionOptions = {
  negate?: boolean;
};

export interface Condition extends Node<ConditionValue, ConditionOptions> {
  eval(context: Context): MaybePromise<Bool>;
}

export class Condition extends Node<ConditionValue, ConditionOptions> {
  type = 'Condition' as const;
  shortType = 'condition' as const;

  constructor(value: ConditionValue, options?: ConditionOptions, location?: any, treeContext?: any) {
    super(value, options, location, treeContext);
    // Conditions are always non-static, but can inherit may_async from children
    this.addFlags(F_VISIBLE, F_NON_STATIC);
  }

  override toTrimmedString(options?: PrintOptions) {
    options = getPrintOptions(options);
    const w = options.writer!;
    const mark = w.mark();
    let [left, op, right] = this.value;
    const needsParens = Boolean(right || this.options?.negate);
    if (this.options?.negate) {
      w.add('not ');
    }
    if (needsParens) {
      w.add('(');
    }
    left.toString(options);
    if (op && right) {
      w.add(' ');
      w.add(String(op));
      w.add(' ');
      right.toString(options);
    }
    if (needsParens) {
      w.add(')');
    }
    return w.getSince(mark);
  }

  static getBool(node: Node, negated: boolean): Bool {
    if (node instanceof Bool) {
      return new Bool(negated ? !node.value : node.value);
    }
    // Less guards treat only explicit booleans as truthy.
    // Any non-boolean (number, quoted, keyword, list, nil, etc.) is false.
    return new Bool(negated);
  }

  static getResult(a: Node, b: Node, op: ConditionOperator): boolean {
    switch (op) {
      case 'and': return Condition.getBool(a, false).value && Condition.getBool(b, false).value;
      case 'or': return Condition.getBool(a, false).value || Condition.getBool(b, false).value;
      default:
        switch (a.compare(b)) {
          case -1:
            return op === '<' || op === '<=';
          case 0:
            return op === '=' || op === '>=' || op === '<=';
          case 1:
            return op === '>' || op === '>=';
          default:
            return false;
        }
    }
  }

  override evalNode(context: Context): MaybePromise<Bool> {
    let [left, op, right] = this.value;
    let negated = !!this.options?.negate;
    const nodeContainsDefaultCall = (node: Node | undefined): boolean => {
      if (!node) {
        return false;
      }
      if (node.type === 'DefaultGuard') {
        return true;
      }
      if (node.type === 'Any') {
        const anyVal = String((node as any).valueOf?.() ?? (node as any).value ?? '');
        if (anyVal === 'default' || anyVal === '??') {
          return true;
        }
      }
      if (node.type === 'Call') {
        const callName = String((node as any).value?.name?.valueOf?.() ?? (node as any).value?.name ?? '');
        if (callName === 'default' || callName === '??') {
          return true;
        }
      }
      const value = (node as any).value;
      if (Array.isArray(value)) {
        return value.some(item => item && typeof item === 'object' && 'type' in item && nodeContainsDefaultCall(item as Node));
      }
      if (value && typeof value === 'object') {
        for (const entry of Object.values(value)) {
          if (entry && typeof entry === 'object' && 'type' in (entry as any) && nodeContainsDefaultCall(entry as Node)) {
            return true;
          }
          if (Array.isArray(entry)) {
            for (const child of entry) {
              if (child && typeof child === 'object' && 'type' in (child as any) && nodeContainsDefaultCall(child as Node)) {
                return true;
              }
            }
          }
        }
      }
      return false;
    };
    const rightContainsDefault = nodeContainsDefaultCall(right);

    return pipe(
      () => left.eval(context),
      (a) => {
        if (!right) {
          // Defer unary coercion to the final stage to avoid double-negation.
          return a;
        }
        return a;
      },
      (a) => {
        if (!right) {
          return [a];
        }
        let b = right.eval(context);
        if (isThenable(b)) {
          return (b as Promise<Node>).then(bb => [a, bb] as const);
        }
        return [a, b];
      },
      ([a, b]) => {
        if (!b) {
          const unary = Condition.getBool(a, negated);
          return unary;
        }
        const normalizeDefaultCall = (node: Node): Node => {
          if (node.type !== 'Call') {
            return node;
          }
          const callName = String((node as any).value?.name?.valueOf?.() ?? (node as any).value?.name ?? '');
          if (callName === 'default' || callName === '??') {
            return new Bool(Boolean(context.isDefault));
          }
          return node;
        };
        a = normalizeDefaultCall(a);
        b = normalizeDefaultCall(b);
        if (op === '=' && rightContainsDefault) {
        }
        if (op === '=') {
          const leftVal = String(a.valueOf?.() ?? '');
          const rightVal = String(b.valueOf?.() ?? '');
          if (
            leftVal.includes('default')
            || rightVal.includes('default')
            || leftVal.includes('??')
            || rightVal.includes('??')
          ) {
          }
        }
        let compareResult = op === 'and' || op === 'or' ? null : a.compare(b);
        let result = Condition.getResult(a, b, op!);
        const equalityMode = a.treeContext?.equalityMode ?? b.treeContext?.equalityMode ?? context.treeContext?.equalityMode ?? 'coerce';
        return new Bool(negated ? !result : result);
      }
    );
  }
}
export const condition = defineType(Condition, 'Condition');