import { type Context } from '../context';
import { Bool } from './bool';
import { Expression } from './expression';
import { Operation } from './operation';
import { Node, defineType } from './node';
import { Dimension } from './dimension';
import { type PrintOptions, getPrintOptions } from './util/print';
// import type { Context } from '../context'
// import type { OutputCollector } from '../output'

export type ParenOptions = {
  escaped: boolean;
};

const isOpOrExpression = (node: Node): node is Operation | Expression => {
  return node instanceof Operation || node instanceof Expression;
};

/**
 * An expression in parenthesis
 */
export class Paren extends Node<Node | undefined, ParenOptions> {
  type = 'Paren' as const;
  shortType = 'paren' as const;

  override toTrimmedString(options?: PrintOptions): string {
    options = getPrintOptions(options);
    const w = options.writer!;
    const mark = w.mark();
    const escapeChar = this.options?.escaped ? '~' : '';
    if (escapeChar) w.add(escapeChar, this);
    w.add('(');
    if (this.value) {
      if (this.value instanceof Node) {
        this.value.toString(options);
      } else {
        w.add(String(this.value), this);
      }
    }
    w.add(')');
    return w.getSince(mark);
  }

  override async evalNode(context: Context): Promise<Node> {
    let { value } = this;
    if (value) {
      let isOp = isOpOrExpression(value);
      context.parenFrames.push(true);
      value = await value.eval(context);
      context.parenFrames.pop();
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
    }
    let node = this.maybeClone(context);
    node.value = value;
    return node;
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