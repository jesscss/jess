import type { Context } from '../context.js';
import { type Node, type NodeOptions, defineType } from './node.js';
import { Selector } from './selector.js';
import type { MaybePromise } from '@jesscss/awaitable-pipe';

export abstract class SimpleSelector<
  T = any,
  O extends NodeOptions = NodeOptions
> extends Selector<T, O> {
  override resolve(context: Context): MaybePromise<Node> {
    return this.evalNode(context);
  }
}

defineType(SimpleSelector, 'SimpleSelector');
