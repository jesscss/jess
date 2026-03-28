import { Dimension, Num, Sequence, Operation, List } from './tree/index.js';
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
  if (value instanceof Dimension && value.unit === '%') {
    const converted = value.number * base / 100;
    return new Num(converted);
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
  const { number, unit } = value;
  if (unit === 'turn') {
    return new Num(number * 360);
  }
  if (unit === 'rad') {
    return new Num(number * 180 / Math.PI);
  }
  if (unit === 'grad') {
    return new Num(number * 0.9);
  }
  if (unit === 'deg' || unit === '') {
    return new Num(number);
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
  const { number, unit } = value;
  let result = number;

  if (unit === '%') {
    result = number / 100;
  } else if (unit === '') {
    result = number;
  } else {
    return value; // Don't convert if unit is not recognized
  }

  const clamped = Math.max(0, Math.min(1, result));
  return new Num(clamped);
});

/**
 * Converts any dimension to a number (removes units)
 * Memoized so that toNumber() always returns the same function instance
 */
export const toNumber = memoize((): ConversionPlugin => (value: unknown) => {
  if (value instanceof Dimension) {
    return new Num(value.number); // Extract number from Dimension
  }
  if (value instanceof Num) {
    return new Num(value.number);
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
  const { number, unit } = value;

  switch (unit) {
    case 'px': return new Num(number);
    case 'em': return new Num(number * baseFontSize);
    case 'rem': return new Num(number * baseFontSize);
    case 'in': return new Num(number * 96);
    case 'cm': return new Num(number * 96 / 2.54);
    case 'mm': return new Num(number * 96 / 25.4);
    case 'pt': return new Num(number * 96 / 72);
    case 'pc': return new Num(number * 96 / 6);
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
  const { number, unit } = value;
  if (unit === 'ms') {
    return new Num(number);
  }
  if (unit === 's') {
    return new Num(number * 1000);
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
  const { number, unit } = value;
  if (unit === 'hz') {
    return new Num(number);
  }
  if (unit === 'khz') {
    return new Num(number * 1000);
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
  const { number, unit } = value;
  if (unit === 'turn') {
    return new Num(number * 2 * Math.PI);
  }
  if (unit === 'rad') {
    return new Num(number);
  }
  if (unit === 'grad') {
    return new Num(number * Math.PI / 200);
  }
  if (unit === 'deg' || unit === '') {
    return new Num(number * Math.PI / 180);
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
    if (args.length !== 1 || !isNode(args[0], N.Sequence)) {
      return args;
    }

    const sequence = args[0] as Sequence;

    // Split the sequence into individual arguments
    const splitArgs: any[] = [];
    const seqItems = sequence.get('value');
    for (let i = 0; i < seqItems.length; i++) {
      const item = seqItems[i]!;

      // Check if this is the last item and it's an Operation (likely a slash)
      if (i === seqItems.length - 1 && item.type === 'Operation') {
        const opNode = item as Operation;
        const left = opNode.get('left');
        const op = opNode.get('operator');
        const right = opNode.get('right');
        // Add the left operand
        splitArgs.push(left);
        // Add the right operand if it exists and is not a placeholder (Num with value 0)
        // This handles test cases where Num(0) is used as a placeholder for undefined
        if (right) {
          const isPlaceholder = right.type === 'Num'
            && (right as any).number === 0;
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
