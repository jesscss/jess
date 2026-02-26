import { Any, Dimension, Node, defineFunction } from '@jesscss/core';
import { syncLog } from '@jesscss/core/debug-log';

type UnitGroup = Record<string, number>;

const unitGroups: UnitGroup[] = [{
  m: 1,
  cm: 0.01,
  mm: 0.001,
  in: 0.0254,
  px: 0.0254 / 96,
  pt: 0.0254 / 72,
  pc: 0.0254 / 72 * 12
}, {
  s: 1,
  ms: 0.001
}, {
  rad: 1 / (2 * Math.PI),
  deg: 1 / 360,
  grad: 1 / 400,
  turn: 1
}];

function toCanonical(node: Dimension, forcedUnit?: string) {
  const number = node.value.number;
  const unit = node.value.unit || forcedUnit || '';
  if (!unit) {
    return { number, unit: '' };
  }
  for (const group of unitGroups) {
    if (group[unit] !== undefined) {
      const canonical = 'px' in group ? 'px' : 's' in group ? 's' : 'rad';
      return { number: number * (group[unit] / group[canonical]!), unit: canonical };
    }
  }
  return { number, unit };
}

export default defineFunction(
  'min',
  function(this: any, ...input: Node[]) {
    let args = input.slice();
    const unitMode = this?.context?.opts?.unitMode ?? 'loose';
    const isLooseMode = unitMode === 'loose';
    const order: Dimension[] = [];
    const values: Record<string, number> = {};
    let unitStatic: string | undefined;
    let unitClone: string | undefined;
    // #region agent log
    syncLog({
      sessionId: process.env.DEBUG_SESSION_ID,
      runId: 'minmax-debug',
      hypothesisId: 'HMM1',
      location: 'packages/fns/src/less/min.ts:entry',
      message: 'min called',
      data: {
        argTypes: args.map(a => a?.type ?? typeof a),
        argCount: args.length,
        unitMode,
        isLooseMode
      },
      timestamp: Date.now()
    });
    // #endregion

    for (let i = 0; i < args.length; i++) {
      let current = args[i] as unknown;
      if (!(current instanceof Dimension)) {
        if (current && typeof current === 'object' && Array.isArray((current as any).value)) {
          args.push(...((current as any).value as Node[]));
          continue;
        }
        // #region agent log
        syncLog({
          sessionId: process.env.DEBUG_SESSION_ID,
          runId: 'minmax-debug',
          hypothesisId: 'HMM2',
          location: 'packages/fns/src/less/min.ts:incompatibleType',
          message: 'min incompatible type',
          data: { currentType: (current as any)?.type ?? typeof current },
          timestamp: Date.now()
        });
        // #endregion
        throw new TypeError('incompatible types');
      }

      const currentUnified = toCanonical(current, current.value.unit ? undefined : unitClone);
      const unit = currentUnified.unit === '' && unitStatic !== undefined ? unitStatic : currentUnified.unit;
      if (unit !== '' && (unitStatic === undefined || toCanonical(order[0]!, unitClone).unit === '')) {
        unitStatic = unit;
      }
      if (unit !== '' && unitClone === undefined) {
        unitClone = current.value.unit || unit;
      }
      const j = values[''] !== undefined && unit !== '' && unit === unitStatic ? values[''] : values[unit];
      if (j === undefined) {
        if (unitStatic !== undefined && unit !== unitStatic && !isLooseMode) {
          throw new TypeError('incompatible types');
        }
        values[unit] = order.length;
        order.push(current);
        continue;
      }
      const referenceUnified = toCanonical(order[j]!, order[j]!.value.unit ? undefined : unitClone);
      if (currentUnified.number < referenceUnified.number) {
        order[j] = current;
      }
    }

    if (order.length === 1) {
      return order[0];
    }
    const sep = this?.context?.compress ? ',' : ', ';
    const serialized = order.map(n => n.toString({ context: this?.context }).trimStart());
    // #region agent log
    syncLog({
      sessionId: process.env.DEBUG_SESSION_ID,
      runId: 'minmax-debug',
      hypothesisId: 'HMM3',
      location: 'packages/fns/src/less/min.ts:fallbackAny',
      message: 'min returned fallback any',
      data: {
        orderTypes: order.map(n => n?.type ?? null),
        orderValues: order.map(n => n?.toString?.({ context: this?.context })),
        normalizedValues: serialized,
        orderLen: order.length
      },
      timestamp: Date.now()
    });
    // #endregion
    return new Any(`min(${serialized.join(sep)})`);
  },
  {
    params: [{
      name: 'values',
      type: [Node, 'number'],
      rest: true
    }]
  }
);