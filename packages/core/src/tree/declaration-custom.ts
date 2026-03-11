import { Declaration } from './declaration.js';
import { defineType } from './node.js';
import type { Context } from '../context.js';
import type { Nil } from './nil.js';
import { type MaybePromise, pipe } from '@jesscss/awaitable-pipe';
// import type { OutputCollector } from '../output'

/**
 * A declaration that retains all tokens
 * (white-space, comments, etc)
 *
 * Ideally, perhaps, the value would just be
 * one Anonymous node for now?
 *
 * @todo - is this used?
 */
export class CustomDeclaration extends Declaration {
  override evalNode(context: Context): MaybePromise<this | Nil> {
    context.inCustom = true;
    return pipe(
      () => super.evalNode(context),
      (node) => {
        context.inCustom = false;
        return node as this | Nil;
      }
    );
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
  //   this.data.toCSS(context, out)
  //   out.add(';', loc)
  // }

  // toModule(context: Context, out: OutputCollector) {
  //   const pre = context.pre
  //   const loc = this.location
  //   out.add('$J.custom({\n', loc)
  //   out.add(`  ${pre}name: `)
  //   this.name.toModule(context, out)
  //   out.add(`\n  ${pre}value: `)
  //   this.data.toModule(context, out)
  //   out.add(`\n${pre}})`)
  // }
}

export const customdecl = defineType(CustomDeclaration, 'CustomDeclaration', 'custom');