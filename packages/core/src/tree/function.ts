import { type Context } from '../context.js';
import { AtRule } from './at-rule.js';
import { defineType } from './node.js';
import { Rules } from './rules.js';
import type { Node } from './node.js';
import { Mixin } from './mixin.js';
import { type MaybePromise, isThenable, pipe, tryStep } from '@jesscss/awaitable-pipe';

/**
 * Functions are mixins with a return value,
 * defined in a stylesheet. Called `Func` to avoid conflict
 * with the built-in `Function` class.
 *
 *  e.g. `my-function($a; $b): { ... }`
 *
 * Used by Jess / Sass
 */
export interface Func extends Mixin {
  eval(context: Context): MaybePromise<Node>;
}

export class Func extends Mixin {
  override type = 'Func' as const;
  override shortType = 'fn' as const;

  /** @todo - We need to evaluate this like mixins, but with a return value */
  evalCall(context: Context): MaybePromise<Node> {
    return pipe(
      () => super.evalNode(context),
      tryStep((result: Node) => {
        if (result instanceof Rules) {
          const decl = result.find('declaration', 'return', 'Declaration', { searchParents: false });
          if (!decl) {
            throw new Error(`Function ${this.value.name} must return a value`);
          }
        }
        return result;
      }, { rethrow: true })
    );
  }
}

export const fn = defineType(Func, 'Func', 'fn');