import { type Context } from '../context.js';
import { F_NON_STATIC, F_VISIBLE, Node, defineType, type NodeLocation } from './node.js';
import { Bool, createPublicBool } from './bool.js';
import { type FinalPrintOptions, type PrintOptions, getPrintOptions } from './util/print.js';
import { type MaybePromise, isThenable } from '@jesscss/awaitable-pipe';
import {
  isRenderBuffer,
  writeRenderText,
  type RenderBuffer
} from './util/render-buffer.js';
import { getDefaultGuardValue } from './util/default-guard.js';
import { sourceSpanOf } from './util/provenance.js';

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
  static override childKeys = ['left', 'right'] as const;

  readonly left: Node;
  readonly operator: ConditionOperator | undefined;
  readonly right: Node | undefined;
  readonly negate: boolean;

  constructor(
    value: ConditionValue,
    options?: ConditionOptions,
    location?: NodeLocation,
    treeContext?: Context['treeContext']
  ) {
    super(value, options, location);
    this.left = value[0];
    this.operator = value[1];
    this.right = value[2];
    this.negate = options?.negate === true;
    this._treeContext = treeContext;
    // Conditions are always non-static, but can inherit may_async from children
    this.addFlags(F_VISIBLE, F_NON_STATIC);
  }

  /**
   * The base `clone()` rebuilds a multi-field node's value as an object keyed by
   * `childKeys`, but Condition's constructor takes the array form `[left, op, right]`
   * and carries `operator` outside `childKeys`. Rebuild the array (mapping the child
   * nodes) so a clone/placement-copy keeps its operands and operator instead of
   * collapsing to an empty Condition.
   */
  override clone(cloneFn?: (n: Node) => Node): this {
    const map = cloneFn ?? ((n: Node) => n);
    const value: ConditionValue = this.operator !== undefined && this.right !== undefined
      ? [map(this.left), this.operator, map(this.right)]
      : [map(this.left)];
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const Ctor = this.constructor as new (
      value: ConditionValue,
      options?: ConditionOptions,
      location?: NodeLocation,
      treeContext?: Context['treeContext']
    ) => this;
    const cloned = new Ctor(value, { negate: this.negate }, sourceSpanOf(this), this._treeContext);
    cloned.inherit(this);
    return cloned;
  }

  /** @internal */
  override writeSyntax(options: FinalPrintOptions): void {
    const w = options.writer;
    const { left, operator: op, right, negate } = this;
    const needsParens = Boolean(right || negate);
    if (negate) {
      w.add('not ');
    }
    if (needsParens) {
      w.add('(');
    }
    left.writeSyntax(options);
    if (op && right) {
      w.add(' ');
      w.add(String(op));
      w.add(' ');
      right.writeSyntax(options);
    }
    if (needsParens) {
      w.add(')');
    }
  }

  override toTrimmedString(rawOptions?: PrintOptions) {
    const options = getPrintOptions(rawOptions);
    const position = options.writer.position();
    this.writeSyntax(options);
    return options.writer.getSince(position);
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
    let value: boolean;
    if (typeof node === 'boolean') {
      value = node;
    } else if (node instanceof Bool) {
      value = node.value;
    } else {
      // A keyword `true`/`false` read back from a declaration/namespace lookup
      // (`#ns.opts[flag]` where `flag: true`) is a bare Keyword, not a Bool, but
      // Less treats it as a boolean in guards. Any other value is falsy.
      value = String(node.valueOf?.() ?? '') === 'true';
    }
    return negated ? !value : value;
  }

  /**
   * Whether a bare (non-Condition) guard's evaluated result passes. A guard body
   * that is a single value — `when (true)`, `when (#ns.opts[flag])` — evaluates to
   * a `Bool` or a keyword `true`/`false`; both are honoured (matching Less), where
   * a strict `instanceof Bool` check would drop a keyword-valued lookup.
   */
  static resultPasses(node: Node | boolean): boolean {
    return Condition.getBoolValue(node as ConditionResultValue, false);
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
    const { left, operator: op, right } = this;
    const negated = this.negate;
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
