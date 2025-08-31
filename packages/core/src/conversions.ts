import { Dimension, Num } from './tree';

// Conversion function types
export type ConversionPlugin = (value: unknown) => number | unknown;

/**
 * Converts percentage values to a fraction of the specified base value
 * @param base - The base value to convert percentages to (e.g., 255 for RGB, 100 for HSL)
 */
export const percentOf = (base: number): ConversionPlugin => (value: unknown) => {
  console.log(`percentOf(${base}) called with:`, value, 'type:', typeof value, 'instanceof Dimension:', value instanceof Dimension);
  if (value instanceof Dimension && value.value.unit === '%') {
    const result = value.value.number * base / 100;
    console.log(`percentOf(${base}) returning:`, result);
    return result;
  }
  console.log(`percentOf(${base}) returning unchanged:`, value);
  return value;
};

/**
 * Converts angle units to degrees
 * Supports: deg, turn, rad, grad
 */
export const angleToDegrees = (): ConversionPlugin => (value: unknown) => {
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
};

/**
 * Normalizes hue values to 0-360 degree range
 * Supports: deg, turn, rad, grad, % (percentage of 360)
 */
export const normalizeHue = (): ConversionPlugin => (value: unknown) => {
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
};

/**
 * Converts alpha values to 0-1 range
 * Supports: % (percentage of 1), unitless numbers
 */
export const alphaToNumber = (): ConversionPlugin => (value: unknown) => {
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
};

/**
 * Converts any dimension to a number (removes units)
 */
export const toNumber = (): ConversionPlugin => (value: unknown) => {
  console.log('toNumber() called with:', value, 'type:', typeof value, 'instanceof Dimension:', value instanceof Dimension);
  if (value instanceof Dimension) {
    const result = value.value.number; // Extract number froDimension
    console.log('toNumber() returning:', result);
    return result;
  }
  console.log('toNumber() returning unchanged:', value);
  return value; // Don't know how to handle this, pass through
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
