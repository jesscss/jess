import { type NodeOptions, type NodeValueObject, defineType } from './node';
import { Selector } from './selector';

type SimpleSelectorValue = string | NodeValueObject;

export abstract class SimpleSelector<
  T extends SimpleSelectorValue = SimpleSelectorValue,
  O extends NodeOptions = NodeOptions
> extends Selector<T, O> {}

defineType(SimpleSelector, 'SimpleSelector');