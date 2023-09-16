import { Node, defineType } from './node'
import { Nil } from './nil'
import type { Context } from '../context'
import { Rule } from './rule'
import { type Anonymous } from './anonymous'
import { Selector } from './selector'
import { type List } from './list'

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
  constructor(...args: Partial<ConstructorParameters<typeof Node<AmpersandValue>>>) {
    let [value, ...rest] = args
    value ??= [['value', undefined]]
    super(value, ...rest)
  }

  toString(): string {
    const { value } = this
    const hoistToRoot = this.options?.hoistToRoot
    return hoistToRoot ?? value ? `&(${value ?? ''})` : '&'
  }

  async eval(context: Context): Promise<Selector | List<Selector> | Ampersand | Nil> {
    return await this.evalIfNot(context, () => {
      if (this.value ?? this.options?.hoistToRoot ?? context.opts.collapseNesting) {
        const frame = context.frames[0]
        if (frame && frame instanceof Rule) {
          if (this.value) {
            return new Selector([['value', [frame.selector.clone(), this.value.clone()]]])
          }
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