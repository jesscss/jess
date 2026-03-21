import { type Context } from '../context.js';
import { Bool } from './bool.js';
import { Expression } from './expression.js';
import { Operation } from './operation.js';
import { Node, defineType, F_NON_STATIC, type LocationInfo, type TreeContext } from './node.js';
import { Dimension } from './dimension.js';
import { type MaybePromise, isThenable } from '@jesscss/awaitable-pipe';
import { type PrintOptions, getPrintOptions } from './util/print.js';
import { sessionGetField, sessionPatchField, sessionSetParent } from './util/session-helpers.js';

export type ParenOptions = {
  escaped: boolean;
};

const isOpOrExpression = (node: Node): node is Operation | Expression => {
  return node instanceof Operation || node instanceof Expression;
};

/**
 * An expression in parenthesis
 */
export interface Paren {
  type: 'Paren';
  shortType: 'paren';
}

export class Paren extends Node<Node | undefined, ParenOptions> {
  static override childKeys = ['value'] as const;

  value: Node | undefined;

  constructor(value?: Node, options?: ParenOptions, location?: LocationInfo, treeContext?: TreeContext) {
    super(value as any, options, location, treeContext);
    this.value = value;
    if (value instanceof Node) {
      this.adopt(value);
    }
    if (options?.escaped) {
      this.addFlag(F_NON_STATIC);
    }
  }

  private _getValue(context?: Context): Node | undefined {
    return context
      ? sessionGetField<Node | undefined>(this, 'value', context)
      : this.value;
  }

  private _unwrapValue(value: Node, context?: Context): Node {
    let current = value;
    while (current instanceof Paren) {
      const next = current._getValue(context);
      if (!next) {
        break;
      }
      current = next;
    }
    return current;
  }

  override toTrimmedString(options?: PrintOptions): string {
    options = getPrintOptions(options);
    const w = options.writer!;
    const mark = w.mark();
    const escapeChar = this.options?.escaped ? '~' : '';
    if (escapeChar) {
      w.add(escapeChar, this);
    }
    w.add('(');
    let value = this._getValue(options.context);
    if (value) {
      if (value instanceof Node) {
        let out = w.capture(() => value.toString(options));
        w.add(out.replace(/^[ \t\r\f]*|[ \t\r\f]*$/g, ''), value);
      } else {
        w.add(String(value), this);
      }
    }
    w.add(')');
    return w.getSince(mark);
  }

  override evalNode(context: Context): MaybePromise<Node> {
    let value = this._getValue(context);
    if (value) {
      let isOp = isOpOrExpression(value);
      if (isOp) {
        context.parenFrames.push(true);
      }
      const maybeEvald = value.eval(context);
      const after = (v: Node): Node => {
        value = v;
        if (isOp) {
          context.parenFrames.pop();
        }
        if (this.options?.escaped && value instanceof Node) {
          return value;
        }
        value = this._unwrapValue(value, context);
        if (value instanceof Bool || value instanceof Dimension) {
          return value;
        }
        if (isOp && !isOpOrExpression(value)) {
          return value;
        }
        let node = this.maybeClone(context);
        if (node === this && context.session && !context.session.resetEvalState) {
          const prevValue = this._getValue(context);
          sessionPatchField(node, 'value', value, context);
          if (prevValue instanceof Node && prevValue !== value) {
            sessionSetParent(prevValue, undefined, context);
          }
          sessionSetParent(value, node, context);
        } else {
          node.setData('value', value);
        }
        return node;
      };
      if (isThenable(maybeEvald)) {
        return (maybeEvald as Promise<Node>).then(after);
      }
      return after(maybeEvald as Node);
    }
    return this;
  }
}

export const paren = defineType(Paren, 'Paren');
