/**
 * Sass unit() function
 *
 * Returns the unit of a number as a quoted string, or changes the unit.
 *
 * @example
 * unit(10px) // "px"
 * unit(10px, em) // 10em
 */
import { defineFunction, Dimension, Quoted, Any } from '@jesscss/core';

const unit = defineFunction(
  'unit',
  function(number: Dimension, newUnit?: Any<'keyword'>): Quoted | Dimension {
    // If newUnit is provided, change the unit
    if (newUnit) {
      const unitValue = typeof newUnit.value === 'string' ? newUnit.value : newUnit.valueOf();
      return new Dimension({
        number: number.value.number,
        unit: unitValue
      });
    }

    // Otherwise, return the unit as a quoted string
    const unitStr = number.value.unit || '';
    return new Quoted(unitStr, { quote: '"' });
  },
  {
    params: [
      {
        name: 'number',
        type: Dimension
      },
      {
        name: 'unit',
        type: Any,
        optional: true
      }
    ]
  }
);

export default unit;
