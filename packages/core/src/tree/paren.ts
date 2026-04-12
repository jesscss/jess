import { type Context } from '../context.js';
import { Bool } from './bool.js';
import { Expression } from './expression.js';
import { Operation } from './operation.js';
import { Node, defineType, F_NON_STATIC, type Mutable } from './node.js';
import { Dimension } from './dimension.js';
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
  if (node.type === 'Paren') {
    return getDefaultGuardBool((node as { value?: Node }).value, context);
  }
  if (node.type !== 'Call') {
    return;
  }
  const rawName = (node as any).value?.name;
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
    const escapeChar = this.options?.escaped ? '~' : '';
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
    let { value } = this;
    if (value) {
      const guardBool = getDefaultGuardBool(value, context);
      if (guardBool) {
        return guardBool;
      }
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
        const evaluatedGuardBool = getDefaultGuardBool(value, context);
        if (evaluatedGuardBool) {
          return evaluatedGuardBool;
        }
        if (this.options?.escaped && value instanceof Node) {
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
        this.set(null, value, context.renderKey);
        return this;
      };
      if (isThenable(maybeEvald)) {
        return (maybeEvald as Promise<Node>).then(after);
      }
      return after(maybeEvald as Node);
    }
    this.set(null, value, context.renderKey);
    return this;
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
