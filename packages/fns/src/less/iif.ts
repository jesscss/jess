import { Any, defineFunction, Node, Bool, type Lazy } from '@jesscss/core';
import { syncLog } from '@jesscss/core/debug-log';

/**
 * if condition, return ifValue, else return elseValue
 */
const iif = defineFunction(
  'if',
  async function(condition: Bool | boolean, thenValue: Lazy<Node>, elseValue?: Lazy<Node>) {
    let bool = typeof condition === 'boolean' ? condition : condition.value;
    if (bool) {
      return await thenValue();
    }
    if (elseValue) {
      return await elseValue();
    }
    // Less returns an empty Anonymous value when false branch has no else.
    // #region agent log
    syncLog({
      sessionId: process.env.DEBUG_SESSION_ID,
      runId: 'if-empty-fallback',
      hypothesisId: 'H_if_anon_1',
      location: 'packages/fns/src/less/iif.ts:if:noElse',
      message: 'if() false without else returned empty anonymous value',
      data: {
        condition: bool
      },
      timestamp: Date.now()
    });
    // #endregion
    return new Any('');
  },
  {
    params: [{
      name: 'condition',
      type: [Bool, 'boolean']
    }, {
      name: 'thenValue',
      type: Node,
      lazy: true
    }, {
      name: 'elseValue',
      type: Node,
      optional: true,
      lazy: true
    }]
  }
);

export default iif;