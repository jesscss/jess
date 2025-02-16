import { defineType, type NodeOptions, type LocationInfo, type TreeContext } from './node'
import { Nil } from './nil'
import type { Context } from '../context'
import { type ComplexSelector } from './selector-complex'
import { type SelectorList } from './selector-list'
import { SimpleSelector } from './selector-simple'
import { BasicSelector } from './selector-basic'
import { isNode } from './util'
import { type Extend } from './extend'
import { type Selector } from './selector'

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
  appendValue?: string
  value: '&'
  /** The evaluated selector */
  selector?: Selector | Nil
}

/**
 * The '&' selector element
 */
export class Ampersand extends SimpleSelector<AmpersandValue> {
  override type = 'Ampersand'
  shortType = 'amp'

  constructor(
    value?: AmpersandValue,
    options?: NodeOptions,
    location?: LocationInfo,
    treeContext?: TreeContext
  ) {
    super(value ?? { value: '&' }, options, location, treeContext)
  }

  override valueOf() {
    const { selector } = this.value
    if (selector) {
      return selector.valueOf()
    }
    return '&'
  }

  override toTrimmedString(): string {
    let { appendValue } = this.value
    return appendValue !== undefined ? `&(${appendValue ?? ''})` : '&'
  }

  /** Hmm this should never return Extend */
  override async evalNode(context: Context): Promise<SelectorList | ComplexSelector | Ampersand | Extend | Nil> {
    const { appendValue } = this.value
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
      amp.data.set('selector', frame.selector.clone(true))
    }
    return amp
    
  }

  /** @todo - move to ToModuleVisitor */
  // toModule(context: Context, out: OutputCollector) {
  //   out.add('$J.amp()', this.location)
  // }
}

export const amp = defineType(Ampersand, 'Ampersand', 'amp')