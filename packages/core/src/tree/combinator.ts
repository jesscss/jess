import type { Context } from '../context.js';
import { defineType } from './node.js';
import { Selector } from './selector.js';

export type Combinators = ' ' | '>' | '+' | '~' | '|' | '||';

export interface Combinator extends Selector<Combinators> {
  eval(context: Context): Combinator;
}

export class Combinator extends Selector<Combinators> {
  type = 'Combinator' as const;
  shortType = 'co' as const;

  /** @todo move to visitor */
  // toCSS(context: Context, out: OutputCollector) {
  //   const val = this.value
  //   out.add(val === ' ' ? val : ` ${val} `, this.location)
  // }

  /** @todo move to visitor */
  // toModule(context: Context, out: OutputCollector) {
  //   out.add(`$J.co("${this.value}")`)
  // }
}
export const co = defineType(Combinator, 'Combinator', 'co');