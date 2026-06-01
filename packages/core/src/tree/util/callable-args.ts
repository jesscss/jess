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
    for (const arg of args) {
      if (isNode(arg)) {
        // Named arguments participate in parameter binding only; evaluating
        // them here would register/override vars in the caller scope.
        if (isNode(arg, N.VarDeclaration)) {
          evaluatedArgs.push(arg);
          continue;
        }
        const evald = await arg.eval(context);
        if (evald.type === 'Rest') {
          const restValue = evald.value;
          if (isNode(restValue, N.Sequence) || isNode(restValue, N.List)) {
            for (const restArg of restValue.value) {
              evaluatedArgs.push(restArg);
            }
            continue;
          }
        }
        evald.frozen = true;
        evaluatedArgs.push(evald);
        continue;
      }
      evaluatedArgs.push(cast(arg));
    }
    return evaluatedArgs;
  });
}
