/**
 * Sass compatible() function (global) / math.compatible() (module)
 *
 * Checks if two numbers have compatible units (can be compared/operated on).
 *
 * @example
 * compatible(10px, 20px) // true
 * compatible(10px, 20rem) // false (incompatible length units)
 * compatible(10px, 20s) // false (different unit types)
 */
import { defineFunction, Dimension, Bool, type FunctionThis, type Context } from '@jesscss/core';

const compatible = defineFunction(
  'compatible',
  function(this: FunctionThis | Context | undefined, number1: Dimension, number2: Dimension): Bool {
    // Get context - either from FunctionThis or directly as Context, or undefined
    let context: Context | undefined;
    if (this) {
      if ('context' in this && typeof this.context !== 'undefined') {
        context = this.context;
      } else if ('opts' in this) {
        // It's a Context object
        context = this as Context;
      }
    }

    // Check if units are compatible
    const unit1 = number1.data.unit;
    const unit2 = number2.data.unit;

    // Both unitless = compatible
    if (!unit1 && !unit2) {
      return new Bool(true);
    }

    // One unitless, one with unit = incompatible for comparison
    if (!unit1 || !unit2) {
      return new Bool(false);
    }

    // Same unit = compatible
    if (unit1 === unit2) {
      return new Bool(true);
    }

    // Check if units are in the same conversion group
    const unitToGroup = number1.unitToGroup;
    const group1 = unitToGroup.get(unit1);
    const group2 = unitToGroup.get(unit2);

    // Same group = compatible (can be converted)
    if (group1 && group2 && group1 === group2) {
      return new Bool(true);
    }

    // Different groups or unknown units = incompatible
    return new Bool(false);
  },
  {
    params: [
      {
        name: 'number1',
        type: Dimension
      },
      {
        name: 'number2',
        type: Dimension
      }
    ]
  }
);

export default compatible;
