import { type NodeOptions, defineType } from './node.js';
import { Selector } from './selector.js';

export abstract class SimpleSelector<
  T = any,
  O extends NodeOptions = NodeOptions,
  CD extends Record<string, unknown> = Record<string, unknown>
> extends Selector<T, O, CD> {}

defineType(SimpleSelector, 'SimpleSelector');