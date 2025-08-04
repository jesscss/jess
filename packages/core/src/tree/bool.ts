import { Node, defineType } from './node';

/**
 * A boolean. Named `Bool` to avoid conflict with the built-in `Boolean` class.
 */
export class Bool extends Node<boolean> {
  type = 'Bool' as const;
  shortType = 'bool' as const;

  override toTrimmedString() {
    return this.value ? 'true' : 'false';
  }
}
export const bool = defineType(Bool, 'Bool');