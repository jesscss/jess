import { type Context } from '../context.js';
import { F_NON_STATIC, F_VISIBLE, Node, defineType, type NodeLocation, type TreeContext } from './node.js';
import { Bool } from './bool.js';
import { type PrintOptions, getPrintOptions } from './util/print.js';
import { type MaybePromise, pipe, isThenable } from '@jesscss/awaitable-pipe';
import {
  isRenderBuffer,
  writeRenderText,
  type RenderBuffer
} from './util/render-buffer.js';

function getCallReferenceKey(name: unknown): string {
  if (!name || typeof name !== 'object' || Reflect.get(name, 'type') !== 'Reference') {
    return '';
  }
  const value = Reflect.get(name, 'value');
  if (!value || typeof value !== 'object') {
    return '';
  }
  const key = Reflect.get(value, 'key');
  return String(
    key && typeof key === 'object' && 'valueOf' in key
      ? Reflect.apply(Reflect.get(key, 'valueOf'), key, [])
      : key ?? ''
  );
}

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
  constructor(value: ConditionValue, options?: ConditionOptions, location?: NodeLocation, treeContext?: TreeContext) {
    super(value, options, location, treeContext);
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
    return pipe(
      () => this.evaluateConditionBoolean(context, 'resolve'),
      (value) => {
        const out = String(value);
        return isRenderBuffer(bufferOrOptions)
          ? writeRenderText(bufferOrOptions, out)
          : out;
      }
    );
  }

  static getBool(node: Node, negated: boolean): Bool {
    return new Bool(Condition.getBoolValue(node, negated));
  }

  static getBoolValue(node: Node, negated: boolean): boolean {
    const value = node instanceof Bool ? node.value : false;
    return negated ? !value : value;
  }

  static getResult(a: Node, b: Node, op: ConditionOperator): boolean {
    switch (op) {
      case 'and': return Condition.getBoolValue(a, false) && Condition.getBoolValue(b, false);
      case 'or': return Condition.getBoolValue(a, false) || Condition.getBoolValue(b, false);
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

  private evaluateConditionBoolean(context: Context, mode: 'eval' | 'resolve'): MaybePromise<boolean> {
    let [left, op, right] = this.value;
    let negated = this._options?.negate === true;
    const normalizeDefaultCall = (node: Node): Node => {
      if (node.type === 'DefaultGuard') {
        return new Bool(Boolean(context.isDefault));
      }
      if (node.type === 'Paren') {
        const inner = node.value;
        return inner instanceof Node ? normalizeDefaultCall(inner) : node;
      }
      if (node.type !== 'Call') {
        return node;
      }
      const rawValue = node.value;
      if (!rawValue || typeof rawValue !== 'object' || !('name' in rawValue)) {
        return node;
      }
      const rawName = rawValue.name;
      const callName = String(rawName?.valueOf?.() ?? rawName ?? '');
      const refKey = getCallReferenceKey(rawName);
      if (callName === 'default' || callName === '??' || refKey === 'default' || refKey === '??') {
        return new Bool(Boolean(context.isDefault));
      }
      return node;
    };

    return pipe(
      () => mode === 'eval' ? left.eval(context) : left.resolve(context),
      (a) => {
        a = normalizeDefaultCall(a);
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
        let b = mode === 'eval' ? right.eval(context) : right.resolve(context);
        if (isThenable(b)) {
          return (b as Promise<Node>).then(bb => [a, bb] as const);
        }
        return [a, b];
      },
      ([a, b]) => {
        if (!b) {
          return Condition.getBoolValue(a, negated);
        }
        a = normalizeDefaultCall(a);
        b = normalizeDefaultCall(b);
        let result = Condition.getResult(a, b, op!);
        return negated ? !result : result;
      }
    );
  }

  private evaluateCondition(context: Context, mode: 'eval' | 'resolve'): MaybePromise<Bool> {
    return pipe(
      () => this.evaluateConditionBoolean(context, mode),
      value => new Bool(value)
    );
  }

  override evalNode(context: Context): MaybePromise<Bool> {
    return this.evaluateCondition(context, 'eval');
  }

  override resolve(context: Context): MaybePromise<Bool> {
    return this.evaluateCondition(context, 'resolve');
  }
}
export const condition = defineType(Condition, 'Condition');
