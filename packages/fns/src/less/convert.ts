import { defineFunction, groupOf, makeDimension, textOf, unitFactor } from '@jesscss/core/value';

/**
 * Less `convert()` — convert a `Dimension` to another unit within the same family
 * (length, duration or angle). Incompatible or unknown units are returned unchanged.
 * @param value the input `Dimension`
 * @param unit the target unit keyword/string
 * @returns the converted `Dimension`
 */
const convert = defineFunction('convert', {
  params: [{ name: 'value', kinds: ['Dimension'] }, { name: 'unit', kinds: ['Keyword', 'Quoted'] }] as const,
  body: (value, targetValue) => {
    const target = textOf(targetValue);
    if (!value.unit || !target || value.unit === target || groupOf(value.unit) !== groupOf(target)) {
      return makeDimension(value.number, value.unit);
    }
    return makeDimension(value.number * (unitFactor(value.unit)! / unitFactor(target)!), target);
  }
});

export { convert };
export default convert;
