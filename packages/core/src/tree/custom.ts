import { Declaration } from './declaration'
import { defineType } from './node'
import type { Context } from '../context'
// import type { OutputCollector } from '../output'

/**
 * A declaration that retains all tokens
 * (white-space, comments, etc)
 *
 * Ideally, perhaps, the value would just be
 * one Anonymous node for now?
 */
export class CustomDeclaration extends Declaration {
  async eval(context: Context) {
    context.inCustom = true
    let node = await super.eval(context)
    context.inCustom = false
    return node
  }

  /** @todo move to visitors */
  // toCSS(context: Context, out: OutputCollector) {
  //   const loc = this.location
  //   this.name.toCSS(context, out)
  //   /**
  //    * Don't insert a space after the colon;
  //    * Instead, insert the exact token stream.
  //    *
  //    * @todo - test this
  //    */
  //   out.add(':', loc)
  //   this.value.toCSS(context, out)
  //   out.add(';', loc)
  // }

  // toModule(context: Context, out: OutputCollector) {
  //   const pre = context.pre
  //   const loc = this.location
  //   out.add('$J.custom({\n', loc)
  //   out.add(`  ${pre}name: `)
  //   this.name.toModule(context, out)
  //   out.add(`\n  ${pre}value: `)
  //   this.value.toModule(context, out)
  //   out.add(`\n${pre}})`)
  // }
}

export const custom = defineType(CustomDeclaration, 'CustomDeclaration', 'custom')