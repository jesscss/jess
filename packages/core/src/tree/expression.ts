import type { Context } from '../context.js';
import { Node, F_NON_STATIC, defineType, type NodeLocation, type NodeOptions, type TreeContext } from './node.js';
import { type PrintOptions, getPrintOptions } from './util/print.js';
import { type MaybePromise, isThenable } from '@jesscss/awaitable-pipe';
import {
  isRenderBuffer,
  type RenderBuffer,
  renderMaybeRenderedOutput,
  writeMaybeRenderedOutput
} from './util/render-buffer.js';

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
  constructor(value: Node, options?: NodeOptions, location?: NodeLocation, treeContext?: TreeContext) {
    super(value, options, location, treeContext);
    this.addFlag(F_NON_STATIC);
  }

  override evalNode(context: Context): MaybePromise<Node> {
    const { value } = this;
    const out = value.eval(context);
    /** @todo - Cast as selector if the context is within a selector */
    if (isThenable(out)) {
      return out as Promise<Node>;
    }
    return out as Node;
  }

  override resolve(context: Context): MaybePromise<Node> {
    const { value } = this;
    const out = value.resolve(context);
    if (isThenable(out)) {
      return out as Promise<Node>;
    }
    return out as Node;
  }

  override render(context: Context, buffer: RenderBuffer, options?: PrintOptions): MaybePromise<string>;
  override render(context: Context, options?: PrintOptions): string;
  override render(context: Context, bufferOrOptions?: RenderBuffer | PrintOptions, options?: PrintOptions): string | MaybePromise<string> {
    if (isRenderBuffer(bufferOrOptions)) {
      return writeMaybeRenderedOutput(bufferOrOptions, this.evalNode(context), context, options);
    }
    return renderMaybeRenderedOutput(this.evalNode(context), context, bufferOrOptions);
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
