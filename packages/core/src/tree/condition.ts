import { type Context } from '../context.js';
import { F_NON_STATIC, F_VISIBLE, Node, defineType, type NodeLocation, type TreeContext } from './node.js';
import { Bool } from './bool.js';
import { type PrintOptions, getPrintOptions, prepareRenderPrintState } from './util/print.js';
import { type MaybePromise, pipe, isThenable } from '@jesscss/awaitable-pipe';
import {
  isRenderBuffer,
  type RenderBuffer,
  writeMaybeRenderedOutput
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
  override render(context: Context, bufferOrOptions?: RenderBuffer | PrintOptions, options?: PrintOptions): string | MaybePromise<string> {
    if (isRenderBuffer(bufferOrOptions)) {
      return writeMaybeRenderedOutput(
        bufferOrOptions,
        this.evaluateCondition(context, 'resolve'),
        context,
        options
      );
    }
    const value = this.evaluateCondition(context, 'resolve');
    const prepared = prepareRenderPrintState(context, bufferOrOptions);
    return isThenable(value)
      ? this.toTrimmedString(prepared)
      : value.toTrimmedString(prepared);
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

  private evaluateCondition(context: Context, mode: 'eval' | 'resolve'): MaybePromise<Bool> {
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
          const unary = Condition.getBool(a, negated);
          return unary;
        }
        a = normalizeDefaultCall(a);
        b = normalizeDefaultCall(b);
        let result = Condition.getResult(a, b, op!);
        return new Bool(negated ? !result : result);
      }
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
