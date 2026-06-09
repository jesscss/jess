import type { Context } from '../context.js';
import { defineType, F_STATIC, type Node } from './node.js';
import { Selector } from './selector.js';
import type { MaybePromise } from '@jesscss/awaitable-pipe';
import type { FinalPrintOptions } from './util/print.js';

export type Combinators = ' ' | '>' | '+' | '~' | '|' | '||';

export interface Combinator extends Selector<Combinators> {
  eval(context: Context): Combinator;
}

export class Combinator extends Selector<Combinators> {
  constructor(...args: ConstructorParameters<typeof Selector<Combinators>>) {
    super(...args);
    this.addFlag(F_STATIC);
  }

  override resolve(context: Context): MaybePromise<Node> {
    return this.evalNode(context);
  }

  override writeSyntax(options: FinalPrintOptions): void {
    options.writer.add(this.value, this);
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
