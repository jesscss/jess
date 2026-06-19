import type { Context } from '../context.js';
import { Node, F_MAY_ASYNC, F_NON_STATIC, defineType, type NodeLocation, type NodeOptions } from './node.js';
import { type FinalPrintOptions, type PrintOptions, getPrintOptions } from './util/print.js';
import { type MaybePromise, isThenable } from '@jesscss/awaitable-pipe';
import { List } from './list.js';
import { Sequence } from './sequence.js';
import {
  isRenderBuffer,
  type RenderBuffer
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
  static override childKeys = ['node'] as const;

  readonly node: Node;

  constructor(
    value: Node,
    options?: NodeOptions,
    location?: NodeLocation,
    treeContext?: Context['treeContext']
  ) {
    super(value, options, location, false);
    this._treeContext = treeContext;
    this.node = value;
    if (value instanceof Node) {
      this.adopt(value);
    }
    this.addFlag(F_NON_STATIC);
  }

  override evalNode(context: Context): MaybePromise<Node> {
    const out = this.node.eval(context);
    /** @todo - Cast as selector if the context is within a selector */
    if (isThenable(out)) {
      return out as Promise<Node>;
    }
    return out as Node;
  }

  override resolve(context: Context): MaybePromise<Node> {
    const out = this.evalNode(context);
    if (isThenable(out)) {
      return out as Promise<Node>;
    }
    return out as Node;
  }

  override render(context: Context, buffer: RenderBuffer, options?: PrintOptions): MaybePromise<string>;
  override render(context: Context, options?: PrintOptions): string;
  override render(context: Context, bufferOrOptions?: RenderBuffer | PrintOptions, options?: PrintOptions): string | MaybePromise<string> {
    if (this.node instanceof List || this.node instanceof Sequence) {
      return isRenderBuffer(bufferOrOptions)
        ? this.node.render(context, bufferOrOptions, options)
        : this.node.render(context, bufferOrOptions);
    }
    if (!this.node.hasFlag(F_MAY_ASYNC)) {
      const node = this.node.eval(context);
      if (!(node instanceof Node)) {
        throw new TypeError('Expected expression value to evaluate to a node');
      }
      return isRenderBuffer(bufferOrOptions)
        ? node.render(context, bufferOrOptions, options)
        : node.render(context, bufferOrOptions);
    }
    const node = this.evalNode(context);
    return isThenable(node)
      ? node.then(renderedNode => isRenderBuffer(bufferOrOptions)
          ? renderedNode.render(context, bufferOrOptions, options)
          : renderedNode.render(context, bufferOrOptions))
      : isRenderBuffer(bufferOrOptions)
        ? node.render(context, bufferOrOptions, options)
        : node.render(context, bufferOrOptions);
  }

  /** @internal */
  override writeSyntax(options: FinalPrintOptions): void {
    const w = options.writer;
    w.add('$', this);
    w.add('(');
    this.node.writeSyntax(options);
    w.add(')');
  }

  override toTrimmedString(options?: PrintOptions): string {
    options = getPrintOptions(options);
    const mark = options.writer.mark();
    this.writeSyntax(options);
    return options.writer.getSince(mark);
  }
}

type Params = ConstructorParameters<typeof Expression>;

export const expr = defineType(Expression, 'Expression', 'expr') as (
  value: Params[0],
  options?: Params[1],
  location?: Params[2],
  treeContext?: Params[3]
) => Expression;
