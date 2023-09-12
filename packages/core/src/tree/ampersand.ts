import { Node, defineType } from './node'
import { Nil } from './nil'
import type { Context } from '../context'
import { Rule } from './rule'
import { type Anonymous } from './anonymous'

export type AmpersandValue = {
  /**
   * The only value that may exist is an anonymous value
   * This is represented as &(). Any &() will signal
   * a forced output (as well as an adjacent ident starting with
   * a dash)
   *
   * @example
     .rule {
       &-foo {
         color: red;
       }
     }
     // output:
     .rule-foo {
       color: red;
     }

     .rule {
       &(-foo) {
         color: red;
       }
     }
     // output:
     .rule-foo {
       color: red;
     }

    .rule {
       &.foo {
         color: red;
       }
     }
     // output:
     .rule {
       &.foo {
         color: red;
       }
     }

     .rule {
       &().foo {
         color: red;
       }
     }
     // output:
     .rule.foo {
       color: red;
     }

   */
  value: Anonymous | undefined
}
/**
 * The '&' selector element
 */
export class Ampersand extends Node<AmpersandValue> {
  /** Return the parent selector from context */
  eval(context: Context) {
    const frame = context.frames[0]
    if (frame && frame instanceof Rule) {
      return frame.selector.clone()
    }
    return new Nil()
  }

  /** @todo - move to ToModuleVisitor */
  // toModule(context: Context, out: OutputCollector) {
  //   out.add('$J.amp()', this.location)
  // }
}

export const amp = defineType(Ampersand, 'Ampersand', 'amp')