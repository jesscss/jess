import { defineFunction, makeDimension, textOf } from '@jesscss/core/value';

/**
 * Less `unit()` — return `dimension` with its unit replaced by `unit` (or the unit
 * stripped when `unit` is omitted). Only the unit changes; the number is untouched.
 * @param dimension the input `Dimension`
 * @param unit optional replacement unit keyword/string
 * @returns a `Dimension` with the new (or no) unit
 */
const unit = defineFunction('unit', {
  params: [{ name: 'dimension', kinds: ['Dimension'] }, { name: 'unit', kinds: ['Keyword', 'Quoted'], optional: true }] as const,
  body: (dimension, replacement) => makeDimension(dimension.number, replacement === undefined ? '' : textOf(replacement) || '')
});

export { unit };
export default unit;
