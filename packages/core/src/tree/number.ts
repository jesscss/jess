import {
  type LocationInfo,
  type NodeOptions,
  type TreeContext,
  defineType,
  type Node
} from './node';
import { Dimension } from './dimension';
import { Color } from './color';
import { type Context } from '../context';
import { type Operator } from './util/calculate';
import isPlainObject from 'lodash-es/isPlainObject';

/**
 * A number. Named `Num` to avoid conflict with the built-in `Number` class.
 */
export class Num extends Dimension {
  override type = 'Number' as const;
  override shortType = 'num' as const;
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
  location?: LocationInfo,
  treeContext?: TreeContext
) => new Num(value, options, location, treeContext);