import { defineFunction, Node, List, Sequence, Dimension, toNumber } from '@jesscss/core';
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

const extract = defineFunction(
  'extract',
  function(this: { rawArgs?: List } | undefined, value: Node, index: number): Node {
    if (typeof index === 'undefined') {
      // #region agent log
      syncLog({
        sessionId: process.env.DEBUG_SESSION_ID,
        runId: 'pre-fix-length-extract-shape',
        hypothesisId: 'H18',
        location: 'packages/fns/src/less/extract.ts:extract:missingIndexArg',
        message: 'extract() called without index argument',
        data: {
          rawArgsLen: this?.rawArgs?.length ?? -1,
          rawArgTypes: this?.rawArgs?.value?.map(n => n.type) ?? []
        },
        timestamp: Date.now()
      });
      // #endregion
    }
    const items = getItems(value);
    const raw = Math.trunc(index);
    if (raw < 0) {
      // #region agent log
      syncLog({
        sessionId: process.env.DEBUG_SESSION_ID,
        runId: 'arg-contract-pre-fix',
        hypothesisId: 'H5',
        location: 'packages/fns/src/less/extract.ts:extract:negativeIndex',
        message: 'extract() received negative index',
        data: {
          raw,
          valueType: value.type,
          itemCount: items.length
        },
        timestamp: Date.now()
      });
      // #endregion
    }
    if (value instanceof List && items.length === 1) {
      const first = items[0];
      // #region agent log
      syncLog({
        sessionId: process.env.DEBUG_SESSION_ID,
        runId: 'pre-fix-length-extract-shape',
        hypothesisId: 'H13_H14',
        location: 'packages/fns/src/less/extract.ts:extract:listOneItem',
        message: 'extract() list has a single item',
        data: {
          index: raw,
          separator: value.options?.sep ?? 'default',
          firstItemType: first?.type ?? 'undefined'
        },
        timestamp: Date.now()
      });
      // #endregion
    }
    if (!Number.isFinite(raw)) {
      // #region agent log
      syncLog({
        sessionId: process.env.DEBUG_SESSION_ID,
        runId: 'pre-fix-length-extract-shape',
        hypothesisId: 'H14',
        location: 'packages/fns/src/less/extract.ts:extract:nonFiniteIndex',
        message: 'extract() got non-finite index after conversion',
        data: {
          indexType: typeof index,
          indexIsNaN: Number.isNaN(index),
          indexString: String(index),
          raw,
          valueType: value.type,
          itemCount: items.length
        },
        timestamp: Date.now()
      });
      // #endregion
      if (items.length === 1) {
        return items[0]!;
      }
    }

    const normalized = raw;
    if (!(value instanceof List) && !(value instanceof Sequence)) {
      // #region agent log
      syncLog({
        sessionId: process.env.DEBUG_SESSION_ID,
        runId: 'pre-fix-length-extract-shape',
        hypothesisId: 'H10_H11',
        location: 'packages/fns/src/less/extract.ts:extract',
        message: 'extract() received non-list node',
        data: {
          valueType: value.type,
          index: raw,
          itemCount: items.length
        },
        timestamp: Date.now()
      });
      // #endregion
    }
    if (normalized < 1 || normalized > items.length) {
      // #region agent log
      syncLog({
        sessionId: process.env.DEBUG_SESSION_ID,
        runId: 'arg-contract-pre-fix',
        hypothesisId: 'H16_RANGE',
        location: 'packages/fns/src/less/extract.ts:extract:rangeError',
        message: 'extract() range error details',
        data: {
          valueType: value.type,
          isList: value instanceof List,
          isSequence: value instanceof Sequence,
          valueLocationLen: value.location?.length ?? 0,
          sourceNodeType: value.sourceNode?.type ?? 'undefined',
          rawArgsTypes: this?.rawArgs?.value?.map((n) => n.type) ?? [],
          rawFirstArgType: this?.rawArgs?.value?.[0]?.type ?? 'undefined',
          rawFirstArgValue: this?.rawArgs?.value?.[0]?.valueOf?.(),
          callerType: (this as any)?.context?.caller?.type ?? 'undefined',
          callerParentType: (this as any)?.context?.caller?.parent?.type ?? 'undefined',
          callerParentDeclName: (this as any)?.context?.caller?.parent?.type === 'Declaration'
            ? String((this as any)?.context?.caller?.parent?.value?.name?.valueOf?.() ?? '')
            : undefined,
          itemCount: items.length,
          raw,
          normalized
        },
        timestamp: Date.now()
      });
      // #endregion
      throw new RangeError(`extract() index ${raw} out of range for length ${items.length}`);
    }
    const out = items[normalized - 1]!;
    if (out instanceof Sequence) {
      const normalizedOut = out.copy(true) as Sequence;
      normalizedOut.value.forEach((node, index) => {
        node.pre = index === 0 ? 0 : 1;
      });
      return normalizedOut;
    }
    return out;
  },
  {
    params: [{
      name: 'value',
      type: Node
    }, {
      name: 'index',
      type: Dimension,
      convert: [toNumber()]
    }]
  }
);

export default extract;
