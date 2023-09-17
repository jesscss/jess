import { Node, defineType } from './node'
import { Nil } from './nil'
import type { Context } from '../context'
import { type Selector } from './selector'
import { type List } from './list'
import { isNode } from './util'

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
  value: string | undefined
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
    let { value } = this
    let hoistToRoot = this.options?.hoistToRoot
    return hoistToRoot ?? value ? `&(${value ?? ''})` : '&'
  }

  async eval(context: Context): Promise<Selector | List<Selector> | Ampersand | Nil> {
    return await this.evalIfNot(context, () => {
      if (this.value ?? this.options?.hoistToRoot ?? context.opts.collapseNesting) {
        let frame = context.frames[0]
        if (frame) {
          let selector = frame.selector.clone(true)
          let { value } = this
          if (value && !isNode(selector, 'Nil')) {
            let appendValue = (n: Selector) => {
              let last = n.value[n.value.length - 1]
              if (last.value) {
                last.value += value
              }
            }
            if (isNode(selector, 'List')) {
              selector.value.forEach(appendValue)
            } else {
              appendValue(selector)
            }
          }
          selector.options = {
            ...selector.options ?? {},
            hoistToRoot: true
          }
          return selector
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