import type { Context } from '../context.js';
import { Node, defineType } from './node.js';
import { type PrintOptions, getPrintOptions } from './util/print.js';
import { type MaybePromise, isThenable } from '@jesscss/awaitable-pipe';
import { isNode } from './util/is-node.js';
import { syncLog } from './util/__tests__/debug-log.js';

export type ExpressionOptions = {
  parens?: boolean;
};

/**
 * An expression is a node that returns a value.
 * It can contain values, references, and operations.
 *
 * When parsing Less/Sass, everything containing an operation is
 * considered an expression.
 */
export interface Expression extends Node<Node, ExpressionOptions> {
  eval(context: Context): MaybePromise<Node>;
}

export class Expression extends Node<Node, ExpressionOptions> {
  type = 'Expression' as const;
  shortType = 'expr' as const;

  override evalNode(context: Context): MaybePromise<Node> {
    const { value } = this;
    // #region agent log
    try {
      if (isNode(value, 'Call') && isNode((value as any).value?.name, 'Reference')) {
        const raw = (value as any).value.name.value?.key;
        const keyStr = Array.isArray(raw) ? raw.join('') : String(raw?.valueOf?.() ?? raw ?? '');
        if (keyStr.includes('my-mixins') || keyStr === 'ruleset') {
          syncLog({
            sessionId: 'debug-session',
            runId: process.env.DEBUG_RUN_ID ?? 'run',
            hypothesisId: 'H13',
            location: 'expression.ts:evalNode',
            message: 'eval-expression-call',
            data: { keyStr },
            timestamp: Date.now()
          });
        }
      }
    } catch {}
    // #endregion
    const out = value.eval(context);
    /** @todo - Cast as selector if the context is within a selector */
    if (isThenable(out)) {
      return out as Promise<Node>;
    }
    return out as Node;
  }

  override toTrimmedString(options?: PrintOptions): string {
    options = getPrintOptions(options);
    const w = options.writer!;
    let { parens } = this.options;
    const mark = w.mark();
    w.add('$', this);
    if (parens) {
      w.add('(');
    }
    this.value.toString(options);
    if (parens) {
      w.add(')');
    }
    return w.getSince(mark);
  }
}

type Params = ConstructorParameters<typeof Expression>;

export const expr = defineType(Expression, 'Expression', 'expr') as (
  value: Params[0],
  options?: Params[1],
  location?: Params[2],
  treeContext?: Params[3]
) => Expression;