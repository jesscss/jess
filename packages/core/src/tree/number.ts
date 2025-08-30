import {
  type LocationInfo,
  type NodeOptions,
  type TreeContext,
  defineType
} from './node';
import { Dimension } from './dimension';
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
}

defineType(Num, 'Num');

export const num = (
  value: number,
  options?: NodeOptions,
  location?: LocationInfo,
  treeContext?: TreeContext
) => new Num(value, options, location, treeContext);