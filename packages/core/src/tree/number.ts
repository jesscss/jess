import {
  type LocationInfo,
  type NodeOptions,
  type TreeContext,
  defineType,
  type Node
} from './node.js';
import { Dimension } from './dimension.js';
import { Color } from './color.js';
import { type Context } from '../context.js';
import { type Operator } from './util/calculate.js';
import { isPlainObject } from './util/collections.js';

/**
 * A number. Named `Num` to avoid conflict with the built-in `Number` class.
 */
export interface Num {
  type: 'Num';
  shortType: 'num';
}
export class Num extends Dimension {
  // Numbers are static and don't need evaluation

  constructor(value: number | { number: number }, options?: NodeOptions, location?: LocationInfo, treeContext?: TreeContext) {
    super(isPlainObject(value) ? value as { number: number } : { number: value as number }, options, location, treeContext);
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
    if (result instanceof Dimension && !result.data.unit) {
      return new Num(result.data.number).inherit(this);
    }

    // Otherwise, pass through the result as-is
    return result;
  }
}

defineType(Num, 'Num');

export const num = (
  value: number,
  options?: NodeOptions,
  location?: LocationInfo,
  treeContext?: TreeContext
) => new Num(value, options, location, treeContext);