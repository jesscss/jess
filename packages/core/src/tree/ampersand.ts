import { defineType } from './node'
import { Nil } from './nil'
import type { Context } from '../context'
import { type ComplexSelector } from './selector-complex'
import { type SelectorList } from './selector-list'
import { SimpleSelector } from './selector-simple'
import { BasicSelector } from './selector-basic'
import { isNode } from './util'
import { type Extend } from './extend'
import { type Selector } from './selector'
import { type tuple } from '@bloomberg/record-tuple-polyfill'

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
  /** @todo - change to arg to align with pseudo? */
  appendValue?: string
  value?: Selector | Nil
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

  get appendValue(): string | undefined {
    return this.data.get('appendValue')
  }

  set appendValue(v: string | undefined) {
    this.data.set('appendValue', v)
  }

  toTrimmedString(): string {
    let { appendValue } = this
    return appendValue !== undefined ? `&(${appendValue ?? ''})` : '&'
  }

  toNormalPrimitive(): string | tuple {
    const { value } = this
    if (value && !(value instanceof Nil)) {
      return value.toNormalPrimitive()
    }
    return this.toTrimmedString()
  }

  /** Hmm this should never return Extend */
  async eval(context: Context): Promise<SelectorList | ComplexSelector | Ampersand | Extend | Nil> {
    return await this.evalIfNot(context, () => {
      const { appendValue } = this
      if (appendValue ?? context.opts.collapseNesting) {
        let frame = context.frames[0]
        if (frame) {
          let selector = frame.selector.clone(true)
          if (appendValue && !isNode(selector, 'Nil')) {
            let doAppendValue = (n: ComplexSelector | Extend) => {
              if (!n.value) {
                throw new SyntaxError(`Cannot append "${appendValue}" to this type of selector`)
              }
              let last = n.value[n.value.length - 1]
              if (last instanceof BasicSelector) {
                last.value += appendValue
              } else {
                throw new SyntaxError(`Cannot append "${appendValue}" to this type of selector`)
              }
            }
            if (isNode(selector, 'SelectorList')) {
              selector.value.forEach(doAppendValue)
            } else {
              doAppendValue(selector)
            }
          }
          context.opts.collapseNesting = true
          return selector
        }
        return new Nil()
      }
      const amp = this.clone()
      let frame = context.frames[0]
      if (frame) {
        amp.value = frame.selector.clone(true)
      }
      return amp
    })
  }

  /** @todo - move to ToModuleVisitor */
  // toModule(context: Context, out: OutputCollector) {
  //   out.add('$J.amp()', this.location)
  // }
}

export const amp = defineType(Ampersand, 'Ampersand', 'amp')