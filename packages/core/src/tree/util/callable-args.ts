import type { Context } from '../../context.js';
import type { Node } from '../node.js';
import { N } from '../node-type.js';
import { cast } from './cast.js';
import { withRulesContext } from './context.js';
import { isNode } from './is-node.js';

type EvaluateCallableArgsOptions = {
  context: Context;
  rulesContext: Context['rulesContext'];
  args: readonly unknown[];
};

export async function evaluateCallableArgs({
  context,
  rulesContext,
  args
}: EvaluateCallableArgsOptions): Promise<Node[]> {
  return await withRulesContext(context, rulesContext, async () => {
    const evaluatedArgs: Node[] = [];
    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (isNode(arg)) {
        // Named arguments participate in parameter binding only; evaluating
        // them here would register/override vars in the caller scope.
        if (isNode(arg, N.VarDeclaration)) {
          evaluatedArgs.push(arg);
          continue;
        }
        const evald = await arg.eval(context);
        // Detached-ruleset closure capture: a Rules passed as an arg is a lexical
        // closure over the surface where it is WRITTEN (the current caller scope T,
        // which carries per-call param live-slots). Record T so a later `@content()`
        // resolves free vars up it, not the canonical `sourceNode.parent`.
        if (isNode(evald, N.Rules) && context.rulesContext) {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
          (evald as unknown as { _closureScope?: unknown })._closureScope = context.rulesContext;
        }
        if (evald.type === 'Rest') {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
          const restValue = (evald as unknown as { value: Node | undefined }).value;
          if (isNode(restValue, N.List)) {
            for (let j = 0; j < restValue.value.length; j++) {
              evaluatedArgs.push(restValue.value[j]!);
            }
            continue;
          }
          if (isNode(restValue, N.Sequence)) {
            for (let j = 0; j < restValue.value.length; j++) {
              evaluatedArgs.push(restValue.value[j]!);
            }
            continue;
          }
        }
        evaluatedArgs.push(evald);
        continue;
      }
      evaluatedArgs.push(cast(arg));
    }
    return evaluatedArgs;
  });
}
