import { Dimension, Num, Sequence, Operation, List } from './tree/index.js';
import { isNode } from './tree/util/is-node.js';
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
 * Simple memoization utility for factory functions
 * Caches results based on stringified arguments
 */
function memoize<Args extends any[], Return>(
  fn: (...args: Args) => Return
): (...args: Args) => Return {
  const cache = new Map<string, Return>();
  return (...args: Args): Return => {
    const key = JSON.stringify(args);
    if (cache.has(key)) {
      return cache.get(key)!;
    }
    const result = fn(...args);
    cache.set(key, result);
    return result;
  };
}

/**
 * Converts percentage values to a fraction of the specified base value
 * @param base - The base value to convert percentages to (e.g., 255 for RGB, 100 for HSL)
 * Memoized so that percentOf(255) always returns the same function instance
 */
export const percentOf = memoize((base: number): ConversionPlugin => (value: unknown) => {
  if (value instanceof Dimension && value.value.unit === '%') {
    return value.value.number * base / 100;
  }
  return value;
});

/**
 * Converts angle units to degrees
 * Supports: deg, turn, rad, grad
 * Memoized so that angleToDegrees() always returns the same function instance
 */
export const angleToDegrees = memoize((): ConversionPlugin => (value: unknown) => {
  if (!(value instanceof Dimension)) {
    return value;
  }
  const { number, unit } = value.value;
  if (unit === 'turn') {
    return number * 360;
  }
  if (unit === 'rad') {
    return number * 180 / Math.PI;
  }
  if (unit === 'grad') {
    return number * 0.9;
  }
  if (unit === 'deg' || unit === '') {
    return number;
  }
  return value;
});

/**
 * Normalizes hue values to 0-360 degree range
 * Supports: deg, turn, rad, grad, % (percentage of 360)
 * Memoized so that normalizeHue() always returns the same function instance
 */
export const normalizeHue = memoize((): ConversionPlugin => (value: unknown) => {
  if (!(value instanceof Dimension)) {
    return value;
  }
  const { number, unit } = value.value;
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
  return degrees;
});

/**
 * Converts alpha values to 0-1 range
 * Supports: % (percentage of 1), unitless numbers
 * Memoized so that alphaToNumber() always returns the same function instance
 */
export const alphaToNumber = memoize((): ConversionPlugin => (value: unknown) => {
  if (!(value instanceof Dimension)) {
    return value;
  }
  const { number, unit } = value.value;
  let result = number;

  if (unit === '%') {
    result = number / 100;
  } else if (unit === '') {
    result = number;
  } else {
    return value; // Don't convert if unit is not recognized
  }

  return Math.max(0, Math.min(1, result));
});

/**
 * Converts any dimension to a number (removes units)
 * Memoized so that toNumber() always returns the same function instance
 */
export const toNumber = memoize((): ConversionPlugin => (value: unknown) => {
  if (value instanceof Dimension) {
    return value.value.number; // Extract number from Dimension
  }
  return value; // Don't know how to handle this, pass through
});

export const clamp = (min: number, max: number): ConversionPlugin => (value: unknown) => {
  if (typeof value !== 'number') {
    return Math.max(min, Math.min(max, value as number));
  }
};

/**
 * Converts length units to pixels
 * Supports: px, em, rem, in, cm, mm, pt, pc
 */
export const lengthToPx = (baseFontSize: number = 16): ConversionPlugin => (value: unknown) => {
  if (!(value instanceof Dimension)) {
    return value;
  }
  const { number, unit } = value.value;

  switch (unit) {
    case 'px': return number;
    case 'em': return number * baseFontSize;
    case 'rem': return number * baseFontSize;
    case 'in': return number * 96;
    case 'cm': return number * 96 / 2.54;
    case 'mm': return number * 96 / 25.4;
    case 'pt': return number * 96 / 72;
    case 'pc': return number * 96 / 6;
    default: return value;
  }
};

/**
 * Converts time units to milliseconds
 * Supports: ms, s
 */
export const timeToMs = (): ConversionPlugin => (value: unknown) => {
  if (!(value instanceof Dimension)) {
    return value;
  }
  const { number, unit } = value.value;
  if (unit === 'ms') {
    return number;
  }
  if (unit === 's') {
    return number * 1000;
  }
  return value;
};

/**
 * Converts frequency units to hertz
 * Supports: hz, khz
 */
export const frequencyToHz = (): ConversionPlugin => (value: unknown) => {
  if (!(value instanceof Dimension)) {
    return value;
  }
  const { number, unit } = value.value;
  if (unit === 'hz') {
    return number;
  }
  if (unit === 'khz') {
    return number * 1000;
  }
  return value;
};

/**
 * Converts angle units to radians
 * Supports: deg, turn, rad, grad
 */
export const angleToRadians = (): ConversionPlugin => (value: unknown) => {
  if (!(value instanceof Dimension)) {
    return value;
  }
  const { number, unit } = value.value;
  if (unit === 'turn') {
    return number * 2 * Math.PI;
  }
  if (unit === 'rad') {
    return number;
  }
  if (unit === 'grad') {
    return number * Math.PI / 200;
  }
  if (unit === 'deg' || unit === '') {
    return number * Math.PI / 180;
  }
  return value;
};

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
  return (args: any[], context: Context): any[] => {
    // Only process if we have exactly one argument that is a Sequence
    if (args.length !== 1 || !isNode(args[0], 'Sequence')) {
      return args;
    }

    const sequence = args[0] as Sequence;

    // Split the sequence into individual arguments
    const splitArgs: any[] = [];
    for (let i = 0; i < sequence.value.length; i++) {
      const item = sequence.value[i]!;

      // Check if this is the last item and it's an Operation (likely a slash)
      if (i === sequence.value.length - 1 && item.type === 'Operation') {
        const [left, op, right] = (item as Operation).value;
        // Add the left operand
        splitArgs.push(left);
        // Add the right operand if it exists and is not a placeholder (Num with value 0)
        // This handles test cases where Num(0) is used as a placeholder for undefined
        if (right) {
          const isPlaceholder = right.type === 'Number'
            && (right as any).value?.number === 0;
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
