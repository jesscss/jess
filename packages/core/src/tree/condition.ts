import { type Context } from '../context.js';
import { F_NON_STATIC, F_VISIBLE, Node, defineType } from './node.js';
import { Bool } from './bool.js';
import { Nil } from './nil.js';
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
      if (negated) {
        node.value = !node.value;
      }
      return node;
    }
    if (node instanceof Nil) {
      return new Bool(negated);
    }
    return new Bool(true && !negated);
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

    return pipe(
      () => left.eval(context),
      (a) => {
        if (!right) {
          /**
           * If there's no right-hand side node,
           * we coerce the left-hand side node to a boolean
           */
          return Condition.getBool(left, negated);
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
          return Condition.getBool(a, negated);
        }
        let result = Condition.getResult(a, b, op!);
        return new Bool(negated ? !result : result);
      }
    );
  }
}
export const condition = defineType(Condition, 'Condition');