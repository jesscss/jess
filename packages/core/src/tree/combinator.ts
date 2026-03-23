import type { Context } from '../context.js';
import { defineType, F_STATIC, type LocationInfo, type OptionalLocation, type NodeOptions, type TreeContext } from './node.js';
import { Selector } from './selector.js';

export type Combinators = ' ' | '>' | '+' | '~' | '|' | '||';

export interface Combinator extends Selector<Combinators> {
  type: 'Combinator';
  shortType: 'co';
  eval(context: Context): Combinator;
}

export class Combinator extends Selector<Combinators> {
  static override childKeys = null as null;

  value!: Combinators;

  constructor(
    value: Combinators,
    options?: NodeOptions,
    location?: OptionalLocation,
    treeContext?: TreeContext
  ) {
    super(value as any, options, location, treeContext);
    this.value = value;
    this.addFlag(F_STATIC);
  }
}

export const co = defineType(Combinator, 'Combinator', 'co');