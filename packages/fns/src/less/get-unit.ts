import { defineFunction, makeKeyword } from '@jesscss/core/value';

/**
 * Less `get-unit()` — the unit of a `Dimension` as a keyword (empty when unitless).
 * @param value the input `Dimension`
 * @returns the unit as an unquoted keyword
 */
const getUnit = defineFunction('get-unit', {
  params: [{ name: 'value', kinds: ['Dimension'] }] as const,
  body: value => makeKeyword(value.unit)
});

export default getUnit;
