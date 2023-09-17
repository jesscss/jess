import { defineType } from './node'
import { Nil } from './nil'
import type { Context } from '../context'
import { type SelectorSequence } from './selector-sequence'
import { type SelectorList } from './selector-list'
import { SimpleSelector } from './selector-simple'
import { BasicSelector } from './selector-basic'
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
export class Ampersand extends SimpleSelector<AmpersandValue> {
  constructor(...args: Partial<ConstructorParameters<typeof SimpleSelector<AmpersandValue>>>) {
    let [value, ...rest] = args
    value ??= [['value', undefined]]
    super(value, ...rest)
  }

  toTrimmedString(): string {
    let { value } = this
    let hoistToRoot = this.options?.hoistToRoot
    return hoistToRoot ?? value ? `&(${value ?? ''})` : '&'
  }

  async eval(context: Context): Promise<SelectorList | SelectorSequence | Ampersand | Nil> {
    return await this.evalIfNot(context, () => {
      if (this.value ?? this.options?.hoistToRoot ?? context.opts.collapseNesting) {
        let frame = context.frames[0]
        if (frame) {
          let selector = frame.selector.clone(true)
          const { value } = this
          if (value && !isNode(selector, 'Nil')) {
            let appendValue = (n: SelectorSequence) => {
              let last = n.value[n.value.length - 1]
              if (last instanceof BasicSelector) {
                last.value += value
              } else {
                throw new Error(`Cannot append "${value}" to this type of selector`)
              }
            }
            if (isNode(selector, 'SelectorList')) {
              selector.value.forEach(appendValue)
            } else {
              appendValue(selector)
            }
          }
          context.opts.collapseNesting = true
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