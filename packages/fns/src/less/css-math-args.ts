import { formNumber, knownUnit } from '@jesscss/core/form';
import { isValueGroupArray, type Dimension, type ValueGroup } from '@jesscss/core/value';

/** A number a form reads, or what only the browser knows of one, taken to hold a number (Q3). */
export const NUMBER_ARG = { type: ['Dimension', 'FunctionCall'], formSlot: '' } as const;

export const isDimension = (value: ValueGroup): value is Dimension =>
  !isValueGroupArray(value) && value.type === 'Dimension';

/** `value` as the form reads it: a known one is its number in its one unit, whatever math it came from. */
export const plain = (value: ValueGroup): ValueGroup =>
  isDimension(value) ? formNumber(value.number, value.unit) : value;

/** The unit a step or a divisor is written in beside `value`: the one it is known to be in, else a number's (Q3). */
export const unitBeside = (value: ValueGroup): string => knownUnit(value) ?? '';
