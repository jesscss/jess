import { type NodeOptions, defineType } from './node.js';
import { Selector } from './selector.js';

export abstract class SimpleSelector<
  T = any,
  O extends NodeOptions = NodeOptions
> extends Selector<T, O> {}

defineType(SimpleSelector, 'SimpleSelector');