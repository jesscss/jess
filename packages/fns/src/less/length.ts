import { defineFunction, Node, List, Sequence, Dimension } from '@jesscss/core';
import { syncLog } from '@jesscss/core/debug-log';

function getItems(value: Node): Node[] {
  if (value instanceof List && value.length === 1 && value.value[0] instanceof Sequence) {
    return value.value[0].value;
  }
  if (value instanceof List || value instanceof Sequence) {
    return value.value;
  }
  return [value];
}

const length = defineFunction(
  'length',
  function(value: Node): Dimension {
    // #region agent log
    syncLog({
      sessionId: process.env.DEBUG_SESSION_ID,
      runId: 'length-shape',
      hypothesisId: 'H_len_1',
      location: 'packages/fns/src/less/length.ts:length:entry',
      message: 'length() entry value shape',
      data: {
        valueType: value?.type ?? null,
        isList: value instanceof List,
        isSequence: value instanceof Sequence,
        listLen: value instanceof List ? value.length : null,
        sequenceLen: value instanceof Sequence ? value.value.length : null
      },
      timestamp: Date.now()
    });
    // #endregion
    const items = getItems(value);
    if (value instanceof List && items.length === 1) {
      const first = items[0];
      // #region agent log
      syncLog({
        sessionId: process.env.DEBUG_SESSION_ID,
        runId: 'pre-fix-length-extract-shape',
        hypothesisId: 'H13',
        location: 'packages/fns/src/less/length.ts:length:listOneItem',
        message: 'length() list has a single item',
        data: {
          separator: value.options?.sep ?? 'default',
          firstItemType: first?.type ?? 'undefined'
        },
        timestamp: Date.now()
      });
      // #endregion
    }
    if (!(value instanceof List) && !(value instanceof Sequence)) {
      // #region agent log
      syncLog({
        sessionId: process.env.DEBUG_SESSION_ID,
        runId: 'pre-fix-length-extract-shape',
        hypothesisId: 'H10',
        location: 'packages/fns/src/less/length.ts:length',
        message: 'length() received non-list node',
        data: {
          valueType: value.type,
          itemCount: items.length
        },
        timestamp: Date.now()
      });
      // #endregion
    }
    return new Dimension({ number: items.length, unit: undefined });
  },
  {
    params: [{
      name: 'value',
      type: Node
    }]
  }
);

export default length;
