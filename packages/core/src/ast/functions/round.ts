import type { Dimension } from '../value-eval.js';
import { makeDimension } from '../value-factory.js';
import { round as roundNum } from '../serialize-value.js';
import { applyMath } from './math-helper.js';
import type { Fn } from './types.js';

/** Default precision operand (`0`), allocated once. */
const ZERO = makeDimension(0);

/**
 * `round(value, precision = 0)` — reuses the serializer's lodash-faithful `round`
 * (ponytail rung 2: an existing byte-identical primitive). Both operands flow
 * through `applyMath` so the input unit is preserved, matching legacy `round`.
 */
export const round: Fn = {
  name: 'round',
  params: [{ kinds: ['dimension'] }, { kinds: ['dimension'], optional: true }],
  body: (v, p) => applyMath((n, pr) => roundNum(n, pr), undefined, [v as Dimension, (p ?? ZERO) as Dimension]),
};
