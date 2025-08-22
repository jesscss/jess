import { type NodeOptions, defineType } from './node';
import { Selector } from './selector';

export abstract class SimpleSelector<
  T = any,
  O extends NodeOptions = NodeOptions
> extends Selector<T, O> {}

defineType(SimpleSelector, 'SimpleSelector');