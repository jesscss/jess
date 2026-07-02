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
        // Detached-ruleset closure capture: a Rules passed as an arg is a lexical
        // closure over the surface where it is WRITTEN (the current caller scope T,
        // which carries per-call param live-slots). Capture T BEFORE evaluating the
        // arg — the body may be eagerly evaluated here (e.g. `{ x: @outer }`), and its
        // free vars must resolve up T (the re-pointed placement surface), NOT the
        // arg's canonical `.parent`. Setting it post-eval was too late for that eager
        // body eval. `inherit()` propagates `_closureScope` onto the evaluated result.
        const closureScope = context.rulesContext;
        if (isNode(arg, N.Rules) && closureScope) {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
          (arg as unknown as { _closureScope?: unknown })._closureScope = closureScope;
        }
        const evald = await arg.eval(context);
        if (isNode(evald, N.Rules) && closureScope) {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
          (evald as unknown as { _closureScope?: unknown })._closureScope = closureScope;
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
