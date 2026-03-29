import { type Context } from '../context.js';
import { F_NON_STATIC, F_VISIBLE, Node, defineType, type OptionalLocation, type TreeContext } from './node.js';
import { Bool } from './bool.js';
import { type PrintOptions, getPrintOptions } from './util/print.js';
import { type MaybePromise, pipe, isThenable } from '@jesscss/awaitable-pipe';
import { getField } from './util/field-helpers.js';

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

export type ConditionChildData = {
  left: Node;
  operator: ConditionOperator | undefined;
  right: Node | undefined;
  negate: boolean;
};

export interface Condition extends Node<ConditionValue, ConditionOptions, ConditionChildData> {
  type: 'Condition';
  shortType: 'condition';
  eval(context: Context): MaybePromise<Bool>;
}

export class Condition extends Node<ConditionValue, ConditionOptions, ConditionChildData> {
  static override childKeys = ['left', 'right'] as const;

  /** @internal */ readonly left!: Node;
  private readonly operator: ConditionOperator | undefined;
  /** @internal */ readonly right: Node | undefined;
  private readonly negate: boolean;

  override clone(deep?: boolean, cloneFn?: (n: Node) => Node, ctx?: Context): this {
    const left = this.get('left', ctx);
    const operator = this.get('operator', ctx);
    const right = this.get('right', ctx);
    const negate = this.get('negate', ctx);
    const options = (this as any)._meta?.options;
    const cloneChild = cloneFn ?? ((n: Node) => n.clone(deep, cloneFn, ctx));
    const value: ConditionValue = operator !== undefined && right !== undefined
      ? [deep ? cloneChild(left) : left, operator, deep ? cloneChild(right) : right]
      : [deep ? cloneChild(left) : left];
    let clonedOptions = options ? { ...options } : undefined;
    if (negate) {
      (clonedOptions ??= {}).negate = true;
    } else if (clonedOptions) {
      delete clonedOptions.negate;
    }
    const newNode = new (this.constructor as any)(
      value,
      clonedOptions,
      this.location,
      this.treeContext
    );
    newNode.inherit(this);
    return newNode;
  }

  constructor(value: ConditionValue, options?: ConditionOptions, location?: OptionalLocation, treeContext?: TreeContext) {
    super(value as any, options, location, treeContext);
    this.left = value[0];
    this.operator = value[1];
    this.right = value[2];
    this.negate = !!options?.negate;
    if (this.left instanceof Node) {
      this.adopt(this.left);
    }
    if (this.right instanceof Node) {
      this.adopt(this.right);
    }
    // Conditions are always non-static, but can inherit may_async from children
    this.addFlags(F_VISIBLE, F_NON_STATIC);
  }

  override toTrimmedString(options?: PrintOptions) {
    options = getPrintOptions(options);
    const w = options.writer!;
    const mark = w.mark();
    const context = options.context;
    let left = this.get('left', context);
    let op = this.get('operator', context);
    let right = this.get('right', context);
    const negated = this.get('negate', context);
    const needsParens = Boolean(right || negated);
    if (negated) {
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

  static getResult(a: Node, b: Node, op: ConditionOperator, context?: Context): boolean {
    switch (op) {
      case 'and': return Condition.getBool(a, false).value && Condition.getBool(b, false).value;
      case 'or': return Condition.getBool(a, false).value || Condition.getBool(b, false).value;
      default:
        switch (a.compare(b, context)) {
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
    let left = this.get('left', context);
    let op = this.get('operator', context);
    let right = this.get('right', context);
    let negated = this.get('negate', context);

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
          const rawCallName = getField<string | Node | undefined>(node, 'name', context);
          const callName = String(typeof rawCallName === 'string'
            ? rawCallName
            : rawCallName?.valueOf?.() ?? '');
          if (callName === 'default' || callName === '??') {
            return new Bool(Boolean(context.isDefault));
          }
          return node;
        };
        a = normalizeDefaultCall(a);
        b = normalizeDefaultCall(b);
        let result = Condition.getResult(a, b, op!, context);
        return new Bool(negated ? !result : result);
      }
    );
  }
}

export const condition = defineType(Condition, 'Condition');
