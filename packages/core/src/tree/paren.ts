import { type Context } from '../context.js';
import { Bool } from './bool.js';
import { Expression } from './expression.js';
import { Operation } from './operation.js';
import { Node, defineType, F_NON_STATIC } from './node.js';
import { Dimension } from './dimension.js';
import { List } from './list.js';
import { type MaybePromise, isThenable } from '@jesscss/awaitable-pipe';
import { type PrintOptions, getPrintOptions } from './util/print.js';
// import type { Context } from '../context.js'
// import type { OutputCollector } from '../output'

export type ParenOptions = {
  escaped: boolean;
};

const isOpOrExpression = (node: Node): node is Operation | Expression => {
  return node instanceof Operation || node instanceof Expression;
};

const getDefaultGuardBool = (node: Node | undefined, context: Context): Bool | undefined => {
  if (!node) {
    return;
  }
  if (node.type === 'DefaultGuard') {
    return new Bool(Boolean(context.isDefault));
  }
  if (node instanceof Paren) {
    return getDefaultGuardBool(node.value, context);
  }
  if (node.type !== 'Call') {
    return;
  }
  const rawValue = node.value;
  if (!rawValue || typeof rawValue !== 'object' || !('name' in rawValue)) {
    return;
  }
  const rawName = rawValue.name;
  const callName = String(rawName?.valueOf?.() ?? rawName ?? '');
  const refKey = rawName?.type === 'Reference'
    ? String(rawName?.value?.key?.valueOf?.() ?? rawName?.value?.key ?? '')
    : '';
  if (callName === 'default' || callName === '??' || refKey === 'default' || refKey === '??') {
    return new Bool(Boolean(context.isDefault));
  }
};

/**
 * An expression in parenthesis
 */
export class Paren extends Node<Node | undefined, ParenOptions> {
  private withValue(value: Node | undefined): this {
    const node = this.clone();
    node.set(null, value);
    return node;
  }

  constructor(value?: Node, options?: ParenOptions, location?: any, treeContext?: any) {
    super(value, options, location, treeContext);
    if (options?.escaped) {
      this.addFlag(F_NON_STATIC);
    }
  }

  override toTrimmedString(options?: PrintOptions): string {
    options = getPrintOptions(options);
    const w = options.writer!;
    const mark = w.mark();
    const escapeChar = this._options?.escaped ? '~' : '';
    if (escapeChar) {
      w.add(escapeChar, this);
    }
    w.add('(');
    let value = this.value;
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
    const currentValue = this.value;
    if (currentValue) {
      const guardBool = getDefaultGuardBool(currentValue, context);
      if (guardBool) {
        return guardBool;
      }
      const isOp = isOpOrExpression(currentValue);
      if (isOp) {
        context.parenFrames.push(true);
      }
      const maybeEvald = currentValue.eval(context);
      const after = (v: Node): Node => {
        let value = v;
        if (isOp) {
          context.parenFrames.pop();
        }
        const evaluatedGuardBool = getDefaultGuardBool(value, context);
        if (evaluatedGuardBool) {
          return evaluatedGuardBool;
        }
        if (this._options?.escaped && value instanceof Node) {
          if (value instanceof List && value.options?.sep === ';') {
            return new List([...value.value], { ...value.options, sep: ',' }).inherit(value);
          }
          return value;
        }
        /**
         * Removing nested parens or parens around a single
         * dimension is a bit presumptuous, but I think Less's
         * argument is that it's unnecessary at runtime,
         * so it's really just a DX tool that can be ignored
         * on output.
         */
        while (value instanceof Paren && value.value) {
          value = value.value;
        }
        if (value instanceof Bool || value instanceof Dimension) {
          return value;
        }
        if (isOp && !isOpOrExpression(value)) {
          return value;
        }
        if (value === currentValue) {
          return this;
        }
        return this.withValue(value);
      };
      if (isThenable(maybeEvald)) {
        return (maybeEvald as Promise<Node>).then(after);
      }
      return after(maybeEvald as Node);
    }
    return this;
  }

  override resolve(context: Context): MaybePromise<Node> {
    return this.evalNode(context);
  }

  // toCSS(context: Context, out: OutputCollector) {
  //   out.add('(')
  //   this.value.toCSS(context, out)
  //   out.add(')')
  // }

  // toModule(context: Context, out: OutputCollector) {
  //   const loc = this.location
  //   out.add('$J.paren(', loc)
  //   this.value.toModule(context, out)
  //   out.add(')')
  // }
}

export const paren = defineType(Paren, 'Paren');
