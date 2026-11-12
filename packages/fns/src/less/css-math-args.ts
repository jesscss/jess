import { asNumber, formNumber, isDimension, knownUnit } from '@jesscss/core/form';
import { makeDimension, type ValueGroup } from '@jesscss/core/value';
import { fitsAny, inUnits } from './color-ctor-helper.js';

export const fitsNumber = (value: ValueGroup): boolean => inUnits(value, ['']);

/** What `sin()`, `cos()` and `tan()` take: a number or an angle. */
export const fitsAngle = (value: ValueGroup): boolean => inUnits(value, ['', 'deg', 'grad', 'rad', 'turn']);

/** A number a form reads in any unit, or what only the browser knows of one, of no known type taken to hold a number (Q3). */
export const NUMBER_ARG = { type: ['Dimension', 'FunctionCall'], fits: fitsAny } as const;

/** `value` as a number: its known unit dropped. */
export const numberOf = (value: ValueGroup): ValueGroup =>
  isDimension(value) ? makeDimension(value.number) : asNumber(value);

export { isDimension };

/** `value` as the form reads it: a known one is its number in its one unit, whatever math it came from. */
export const plain = (value: ValueGroup): ValueGroup =>
  isDimension(value) ? formNumber(value.number, value.unit) : value;

/** The unit a step or a divisor is written in beside `value`: the one it is known to be in, else a number's (Q3). */
export const unitBeside = (value: ValueGroup): string => knownUnit(value) ?? '';
