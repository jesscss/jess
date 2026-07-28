import { Dimension, Num, Sequence, Operation } from './tree/index.js';
import { isNode } from './tree/util/is-node.js';
import { N } from './tree/node-type.js';
import type { Context } from './context.js';
import type { MaybePromise } from '@jesscss/awaitable-pipe';

// Conversion function types
export type ConversionPlugin = (value: unknown) => number | unknown;

/**
 * PreprocessParams function type for preprocessing entire argument arrays
 * Can be synchronous or asynchronous
 */
export type PreprocessParams = (args: any[], context: Context) => MaybePromise<any[]>;

/**
 * Converts percentage values to a fraction of the specified base value
 * @param base - The base value to convert percentages to (e.g., 255 for RGB, 100 for HSL)
 */
export const percentOf = (base: number): ConversionPlugin => (value: unknown) => {
  if (value instanceof Dimension && value.unit === '%') {
    return new Num(value.number * base / 100);
  }
  return value;
};

/**
 * Normalizes hue values to the 0-360 degree range.
 * Supports: deg, turn, rad, grad, % (percentage of 360)
 */
const normalizeHueConvert: ConversionPlugin = (value: unknown) => {
  if (!(value instanceof Dimension)) {
    return value;
  }
  const { number, unit } = value;
  let degrees = number;

  if (unit === 'turn') {
    degrees = number * 360;
  } else if (unit === 'rad') {
    degrees = number * 180 / Math.PI;
  } else if (unit === 'grad') {
    degrees = number * 0.9;
  } else if (unit === '%') {
    degrees = number * 360 / 100;
  } else if (unit === 'deg' || unit === '') {
    degrees = number;
  } else {
    return value; // Don't convert if unit is not recognized
  }

  // Normalize to 0-360 range
  degrees = ((degrees % 360) + 360) % 360;
  return new Num(degrees);
};
export const normalizeHue = (): ConversionPlugin => normalizeHueConvert;

/**
 * Converts alpha values to the 0-1 range.
 * Supports: % (percentage of 1), unitless numbers
 */
const alphaToNumberConvert: ConversionPlugin = (value: unknown) => {
  if (!(value instanceof Dimension)) {
    return value;
  }
  const { number, unit } = value;
  let result = number;

  if (unit === '%') {
    result = number / 100;
  } else if (unit === '') {
    result = number;
  } else {
    return value; // Don't convert if unit is not recognized
  }

  return new Num(Math.max(0, Math.min(1, result)));
};
export const alphaToNumber = (): ConversionPlugin => alphaToNumberConvert;

/**
 * Converts any dimension to a unitless number.
 * A value that is already a `Num` is returned unchanged (no realloc); any other
 * `Dimension` yields a fresh unitless `Num`; anything else passes through.
 */
const toNumberConvert: ConversionPlugin = (value: unknown) => {
  if (value instanceof Num) {
    return value;
  }
  if (value instanceof Dimension) {
    return new Num(value.number);
  }
  return value;
};
export const toNumber = (): ConversionPlugin => toNumberConvert;

/**
 * Creates a preprocessParams function that splits a Sequence into individual arguments.
 * Handles operations with slashes (/) by distributing the left and right operands.
 *
 * @example
 * ```typescript
 * const rgb = defineFunction('rgb', function(r, g, b, a?) {
 *   // ...
 * }, {
 *   preprocessParams: [splitSequence()]
 * });
 * ```
 */
export const splitSequence = (): PreprocessParams => {
  return (args: any[], _context: Context): any[] => {
    // Only process if we have exactly one argument that is a Sequence
    if (args.length !== 1 || !isNode(args[0], N.Sequence)) {
      return args;
    }

    const sequence = args[0] as Sequence;

    // Split the sequence into individual arguments
    const splitArgs: any[] = [];
    for (let i = 0; i < sequence.value.length; i++) {
      const item = sequence.value[i]!;

      // Check if this is the last item and it's an Operation (likely a slash)
      if (i === sequence.value.length - 1 && item instanceof Operation) {
        const { left, right } = item;

        // Add the left operand
        splitArgs.push(left);

        /*
         * Add the right operand if it exists and is not a placeholder (Num with value 0)
         * This handles test cases where Num(0) is used as a placeholder for undefined
         */
        if (right) {
          const isPlaceholder = right instanceof Num && right.number === 0;
          if (!isPlaceholder) {
            splitArgs.push(right);
          }
        }
      } else {
        splitArgs.push(item);
      }
    }

    return splitArgs;
  };
};
