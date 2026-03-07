import type { Context } from '../context.js';
import { Node, defineType } from './node.js';
import { type PrintOptions, getPrintOptions } from './util/print.js';
import { type MaybePromise, isThenable } from '@jesscss/awaitable-pipe';

/**
 * An expression is a node that returns a value.
 * It can contain values, references, and operations.
 *
 * When parsing Less/Sass, everything containing an operation is
 * considered an expression.
 */
export interface Expression extends Node<Node> {
  eval(context: Context): MaybePromise<Node>;
}

export class Expression extends Node<Node> {
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
    const mark = w.mark();
    w.add('$', this);
    w.add('(');
    this.value.toString(options);
    w.add(')');
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