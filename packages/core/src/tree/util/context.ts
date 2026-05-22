import type { Context } from '../../context.js';
import { isThenable, type MaybePromise } from '@jesscss/awaitable-pipe';

export function withRulesContext<T>(
  context: Context,
  rulesContext: Context['rulesContext'],
  run: () => MaybePromise<T>
): MaybePromise<T> {
  const savedRulesContext = context.rulesContext;
  context.rulesContext = rulesContext;
  let result: MaybePromise<T>;
  try {
    result = run();
  } catch (error) {
    context.rulesContext = savedRulesContext;
    throw error;
  }
  if (isThenable(result)) {
    return Promise.resolve(result).then(
      (value) => {
        context.rulesContext = savedRulesContext;
        return value;
      },
      (error: unknown) => {
        context.rulesContext = savedRulesContext;
        throw error;
      }
    );
  }
  context.rulesContext = savedRulesContext;
  return result;
}
