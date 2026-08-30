import { Declaration, DeclarationValue } from './declaration'
import type { LocationInfo } from './node'
import type { Context } from '../context'
import type { OutputCollector } from '../output'

/**
 * A declaration that retains all tokens
 * (white-space, comments, etc)
 * 
 * Ideally, perhaps, the value would just be
 * one Anonymous node for now
 */
export class CustomDeclaration extends Declaration {
  eval(context: Context) {
    context.inCustom = true
    const node = super.eval(context)
    context.inCustom = false
    return node
  }

  toCSS(context: Context, out: OutputCollector) {
    const loc = this.location
    this.name.toCSS(context, out)
    /**
     * Don't insert a space after the colon;
     * Instead, insert the exact token stream.
     * 
     * @todo - test this 
     */
    out.add(':', loc)
    this.value.toCSS(context, out)
    out.add(';', loc)
  }

  toModule(context: Context, out: OutputCollector) {
    let pre = context.pre
    const loc = this.location
    out.add(`$J.custom({\n`, loc)
    out.add(`  ${pre}name: `)
    this.name.toModule(context, out)
    out.add(`\n  ${pre}value: `)
    this.value.toModule(context, out)
    out.add(`\n${pre}})`)
  }
}
CustomDeclaration.prototype.type = 'CustomDeclaration'

export const custom =
  (value: DeclarationValue, location?: LocationInfo) =>
    new CustomDeclaration(value, location)