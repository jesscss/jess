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
  /** @note Anonymous will be present with &() even if it has an empty value */
  value: Anonymous | undefined
}
/**
 * The '&' selector element
 */
export class Ampersand extends Node<AmpersandValue> {
  constructor(...args: Partial<ConstructorParameters<typeof Node<AmpersandValue>>>) {
    let [value, ...rest] = args
    value ??= [['value', undefined]]
    super(value, ...rest)
  }

  eval(context: Context) {
    return this.evalIfNot(context, () => {
      if (this.value ?? context.opts.collapseNesting) {
        const frame = context.frames[0]
        if (frame && frame instanceof Rule) {
          console.log(frame)
          return frame.selector.clone()
        }
        return new Nil()
      }
      return this.clone()
    })
  }

  /** @todo - move to ToModuleVisitor */
  // toModule(context: Context, out: OutputCollector) {
  //   out.add('$J.amp()', this.location)
  // }
}

export const amp = defineType(Ampersand, 'Ampersand', 'amp')