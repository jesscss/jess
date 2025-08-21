import type { Context } from '../context';
import { Node, defineType } from './node';
import { Selector } from './selector';
import { type PrintOptions, getPrintOptions } from './util/print';
import { type MaybePromise, isThenable } from '@jesscss/awaitable-pipe';

export type ExpressionOptions = {
  parens?: boolean;
};

/**
 * An expression is a node that returns a value.
 * It can contain values, references, and operations.
 *
 * When parsing Less/Sass, everything containing an operation is
 * considered an expression.
 *
 * @note This extends Selector just because it can be
 * in the selector position (initially).
 */
export interface Expression extends Node<Node, ExpressionOptions> {
  eval(context: Context): MaybePromise<Node>;
}

export class Expression extends Node<Node, ExpressionOptions> {
  type = 'Expression' as const;
  shortType = 'expr' as const;

  override evalNode(context: Context): MaybePromise<Node> {
    const { value } = this;
    const out = value.eval(context);
    /** @todo - Cast as selector if the context is within a selector */
    if (isThenable(out)) {
      return out as Promise<Node>;
    }
    return out as Node;
  }

  override toTrimmedString(options?: PrintOptions): string {
    options = getPrintOptions(options);
    const w = options.writer!;
    let { parens } = this.options;
    const mark = w.mark();
    w.add('$', this);
    if (parens) w.add('(');
    this.value.toString(options);
    if (parens) w.add(')');
    return w.getSince(mark);
  }
}

type Params = ConstructorParameters<typeof Expression>;

export const expr = defineType(Expression, 'Expression', 'expr') as (
  value: Params[0],
  options?: Params[1],
  location?: Params[2],
  treeContext?: Params[3]
) => Expression;