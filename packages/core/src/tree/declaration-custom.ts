import { Declaration } from './declaration.js';
import { defineType } from './node.js';
import type { Context } from '../context.js';
import type { Nil } from './nil.js';
import { isThenable, type MaybePromise } from '@jesscss/awaitable-pipe';
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
    try {
      const node = super.evalNode(context);
      if (isThenable(node)) {
        return (node as Promise<this | Nil>).then(
          (resolved) => {
            context.inCustom = false;
            return resolved;
          },
          (error) => {
            context.inCustom = false;
            throw error;
          }
        );
      }
      context.inCustom = false;
      return node as this | Nil;
    } catch (error) {
      context.inCustom = false;
      throw error;
    }
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
  //   const loc = this.location
  //   out.add('$J.custom({\n', loc)
  //   out.add(`  name: `)
  //   this.name.toModule(context, out)
  //   out.add(`\n  value: `)
  //   this.value.toModule(context, out)
  //   out.add(`\n})`)
  // }
}

export const customdecl = defineType(CustomDeclaration, 'CustomDeclaration', 'custom');
