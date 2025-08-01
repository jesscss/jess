import {
  type LocationInfo,
  type NodeOptions,
  type TreeContext
} from './node';
import { Dimension } from './dimension';

/**
 * A number
 */
export class Number extends Dimension {
  override type = 'Number' as const;
  override shortType = 'num' as const;

  constructor(value: number, options?: NodeOptions, location?: LocationInfo, treeContext?: TreeContext) {
    super({ number: value }, options, location, treeContext);
  }
}

export const num = (
  value: number,
  options?: NodeOptions,
  location?: LocationInfo,
  treeContext?: TreeContext
) => new Number(value, options, location, treeContext);