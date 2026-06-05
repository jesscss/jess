import { type Context } from '../context.js';
import { F_NON_STATIC, F_VISIBLE, Node, defineType, type NodeLocation } from './node.js';
import { Bool, createPublicBool } from './bool.js';
import { type PrintOptions, getPrintOptions } from './util/print.js';
import { type MaybePromise, isThenable } from '@jesscss/awaitable-pipe';
import {
  isRenderBuffer,
  writeRenderText,
  type RenderBuffer
} from './util/render-buffer.js';
import { getDefaultGuardValue } from './util/default-guard.js';

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

type ConditionResultValue = Node | boolean;

export interface Condition extends Node<ConditionValue, ConditionOptions> {
  eval(context: Context): MaybePromise<Bool>;
}

export class Condition extends Node<ConditionValue, ConditionOptions> {
  constructor(value: ConditionValue, options?: ConditionOptions, location?: NodeLocation) {
    super(value, options, location);
    // Conditions are always non-static, but can inherit may_async from children
    this.addFlags(F_VISIBLE, F_NON_STATIC);
  }

  override toTrimmedString(options?: PrintOptions) {
    options = getPrintOptions(options);
    const w = options.writer!;
    const mark = w.mark();
    let [left, op, right] = this.value;
    const negate = this._options?.negate === true;
    const needsParens = Boolean(right || negate);
    if (negate) {
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

  override render(context: Context, buffer: RenderBuffer, options?: PrintOptions): MaybePromise<string>;
  override render(context: Context, options?: PrintOptions): string;
  override render(context: Context, bufferOrOptions?: RenderBuffer | PrintOptions, _options?: PrintOptions): string | MaybePromise<string> {
    const value = this.evaluateBoolean(context);
    if (isThenable(value)) {
      return (value as Promise<boolean>).then((resolved) => {
        const out = String(resolved);
        return isRenderBuffer(bufferOrOptions)
          ? writeRenderText(bufferOrOptions, out)
          : out;
      });
    }
    const out = String(value as boolean);
    return isRenderBuffer(bufferOrOptions)
      ? writeRenderText(bufferOrOptions, out)
      : out;
  }

  static getBoolValue(node: ConditionResultValue, negated: boolean): boolean {
    const value = typeof node === 'boolean'
      ? node
      : node instanceof Bool ? node.value : false;
    return negated ? !value : value;
  }

  static getResult(a: ConditionResultValue, b: ConditionResultValue, op: ConditionOperator): boolean {
    switch (op) {
      case 'and': return Condition.getBoolValue(a, false) && Condition.getBoolValue(b, false);
      case 'or': return Condition.getBoolValue(a, false) || Condition.getBoolValue(b, false);
      default:
        if (typeof a === 'boolean' || typeof b === 'boolean') {
          return op === '=' && Condition.getBoolValue(a, false) === Condition.getBoolValue(b, false);
        }
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

  evaluateBoolean(context: Context): MaybePromise<boolean> {
    const [left, op, right] = this.value;
    const negated = this._options?.negate === true;
    const leftResult = left.eval(context);
    if (isThenable(leftResult)) {
      return (leftResult as Promise<Node>).then((resolvedLeft) => {
        const a = getDefaultGuardValue(resolvedLeft, context) ?? resolvedLeft;
        if (!right) {
          return Condition.getBoolValue(a, negated);
        }
        const rightResult = right.eval(context);
        if (isThenable(rightResult)) {
          return (rightResult as Promise<Node>).then((resolvedRight) => {
            const b = getDefaultGuardValue(resolvedRight, context) ?? resolvedRight;
            const result = Condition.getResult(a, b, op!);
            return negated ? !result : result;
          });
        }
        const b = getDefaultGuardValue(rightResult, context) ?? rightResult;
        const result = Condition.getResult(a, b, op!);
        return negated ? !result : result;
      });
    }
    const a = getDefaultGuardValue(leftResult, context) ?? leftResult;
    if (!right) {
      return Condition.getBoolValue(a, negated);
    }
    const rightResult = right.eval(context);
    if (isThenable(rightResult)) {
      return (rightResult as Promise<Node>).then((resolvedRight) => {
        const b = getDefaultGuardValue(resolvedRight, context) ?? resolvedRight;
        const result = Condition.getResult(a, b, op!);
        return negated ? !result : result;
      });
    }
    const b = getDefaultGuardValue(rightResult, context) ?? rightResult;
    const result = Condition.getResult(a, b, op!);
    return negated ? !result : result;
  }

  private evaluateCondition(context: Context): MaybePromise<Bool> {
    const value = this.evaluateBoolean(context);
    return isThenable(value)
      ? (value as Promise<boolean>).then(resolved => createPublicBool(resolved))
      : createPublicBool(value as boolean);
  }

  override evalNode(context: Context): MaybePromise<Bool> {
    return this.evaluateCondition(context);
  }

  override resolve(context: Context): MaybePromise<Bool> {
    return this.evaluateCondition(context);
  }
}
export const condition = defineType(Condition, 'Condition');
