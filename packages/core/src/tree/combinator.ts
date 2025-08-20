import type { Context } from '../context';
import { defineType } from './node';
import { Selector } from './selector';

export interface Combinator extends Selector<string> {
  eval(context: Context): Combinator;
}

export class Combinator extends Selector<string> {
  type = 'Combinator' as const;
  shortType = 'co' as const;

  override valueOf() {
    let valueOf = this._valueOf;
    if (!valueOf) {
      let { value } = this;
      /**
       * Handle space combinators. These get parsed
       * as empty strings.
       */
      valueOf = this._valueOf = value === '' ? ' ' : value;
    }
    return valueOf;
  }

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