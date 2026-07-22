import type { Dimension, EvalModes, ValueGroup, ValueObj } from '@jesscss/core/value';
import { groupItems, isValueGroupArray, makeKeyword, unify as unifyRaw } from '@jesscss/core/value';

const unify = (dimension: Dimension): { number: number; unit: string } =>
  unifyRaw(dimension.number, dimension.unit);

/**
 * Less's unit-grouping policy for `min`/`max`. The value/list structure is
 * universal core capability; only this survivor/unit policy belongs to Less.
 */
export function minMax(isMin: boolean, list: ValueGroup, modes: EvalModes): ValueObj {
  const name = isMin ? 'min' : 'max';
  const args = groupItems(list).flatMap(groupItems);
  if (args.length === 0) {
    throw new TypeError(`${name}() requires at least one numeric argument`);
  }

  const order: Dimension[] = [];
  const values: Record<string, number> = {};
  let unitStatic: string | undefined;
  let unitClone: string | undefined;

  for (const current of args) {
    if (isValueGroupArray(current) || current.type !== 'Dimension') {
      throw new TypeError(`${name}() requires numeric arguments`);
    }

    const currentUnified = current.unit === '' && unitClone !== undefined
      ? unifyRaw(current.number, unitClone)
      : unify(current);
    const unit = currentUnified.unit === '' && unitStatic !== undefined
      ? unitStatic
      : currentUnified.unit;
    unitStatic = (unit !== '' && unitStatic === undefined)
      || (unit !== '' && order.length > 0 && unify(order[0]!).unit === '')
      ? unit
      : unitStatic;
    unitClone = unit !== '' && unitClone === undefined ? current.unit : unitClone;
    const index = values[''] !== undefined && unit !== '' && unit === unitStatic
      ? values['']
      : values[unit];
    if (index === undefined) {
      if (unitStatic !== undefined && unit !== unitStatic && modes.unitMode === 'strict') {
        throw new TypeError(`${name}() arguments have incompatible units`);
      }
      values[unit] = order.length;
      order.push(current);
      continue;
    }

    const referenceUnified = order[index]!.unit === '' && unitClone !== undefined
      ? unifyRaw(order[index]!.number, unitClone)
      : unify(order[index]!);
    if ((isMin && currentUnified.number < referenceUnified.number)
      || (!isMin && currentUnified.number > referenceUnified.number)) {
      order[index] = current;
    }
  }

  if (order.length === 1) {
    return order[0]!;
  }
  return makeKeyword(`${name}(${order.map(value => value.bytes).join(', ')})`);
}
