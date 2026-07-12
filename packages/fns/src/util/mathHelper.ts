import { Dimension, Num } from '@jesscss/core';

const { isArray } = Array;

export function num(values: Dimension | number): number;
export function num(values: Array<Dimension | number>): number[];
export function num(values: Dimension | number | Array<Dimension | number>): number | number[] {
  if (isArray(values)) {
    return values.map(n => n instanceof Dimension ? n.number : n);
  }
  return values instanceof Dimension ? values.number : values;
}

export const mathHelper = (
  fn: (...nums: number[]) => number,
  params: string[],
  unit: string | null | undefined,
  ...input: Array<Dimension | number>
) => {
  let key = 0;
  for (const n of input) {
    if (!(n instanceof Dimension) && typeof n !== 'number') {
      let name = params[key++];
      name = name ? `"${name}" ` : '';
      throw new TypeError(`${name}argument must be numeric`);
    }
  }
  const val = input[0];
  if (unit === null) {
    const numberResult = fn(...num(input));
    const preservedUnit = val instanceof Dimension ? val.unit : undefined;
    return new Dimension({ number: numberResult, unit: preservedUnit });
  }
  const normalizedInput = input.map((v) => {
    if (!(v instanceof Dimension)) {
      return v;
    }
    if (v.unit === 'deg') {
      return v.number * Math.PI / 180;
    }
    if (v.unit === 'grad') {
      return v.number * Math.PI / 200;
    }
    if (v.unit === 'turn') {
      return v.number * 2 * Math.PI;
    }
    return v.number;
  });
  unit ??= val instanceof Dimension ? val.unit : '';
  if (unit === undefined) {
    return new Num(fn(...(normalizedInput as number[])));
  }
  return new Dimension({ number: fn(...(normalizedInput as number[])), unit });
};