import {
  type LocationInfo,
  type NodeOptions,
  defineType,
  type Node
} from './node.js';
import { Dimension } from './dimension.js';
import { Color } from './color.js';
import { type Context } from '../context.js';
import { type Operator } from './util/calculate.js';

/**
 * A number. Named `Num` to avoid conflict with the built-in `Number` class.
 */
export class Num extends Dimension {
  // Numbers are static and don't need evaluation

  constructor(value: number | { number: number }, options?: NodeOptions, location?: LocationInfo) {
    super(typeof value === 'number' ? { number: value } : value, options, location);
  }

  // Method overloads for better type safety
  override operate(b: Num, op: Operator, context?: Context): Num | Dimension;
  override operate(b: Dimension, op: Operator, context?: Context): Dimension;
  override operate(b: Color, op: Operator, context?: Context): Color;
  override operate(b: Node, op: Operator, context?: Context): Dimension | Color;
  override operate(b: Node, op: Operator, context?: Context): Dimension | Color {
    // Call super.operate() to get the result
    const result = super.operate(b, op, context);

    // If the result is a Dimension and has an empty unit, convert it to a Num
    if (result instanceof Dimension && !result.value.unit) {
      return new Num(result.value.number).inherit(this);
    }

    // Otherwise, pass through the result as-is
    return result;
  }
}

defineType(Num, 'Num');

export const num = (
  value: number,
  options?: NodeOptions,
  location?: LocationInfo
) => new Num(value, options, location);
