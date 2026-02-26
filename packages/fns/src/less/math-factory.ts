import { Dimension, defineFunction } from '@jesscss/core';
import { mathHelper } from '../util/mathHelper.js';

type UnaryMathMethod = 'acos' | 'asin' | 'atan' | 'cos' | 'sin' | 'sqrt' | 'tan' | 'abs' | 'ceil' | 'floor';
type MathConstant = 'E' | 'LN10' | 'LN2' | 'LOG10E' | 'LOG2E' | 'PI' | 'SQRT1_2' | 'SQRT2';

export function defineUnaryMathFunction(
  name: string,
  method: UnaryMathMethod,
  outputUnit: string | null
) {
  return defineFunction(
    name,
    function(value: Dimension | number) {
      return mathHelper(Math[method], ['value'], outputUnit, value);
    },
    {
      params: [{
        name: 'value',
        type: [Dimension, 'number']
      }]
    }
  );
}

export function defineMathConstantFunction(name: string, constant: MathConstant) {
  return defineFunction(name, function() {
    return new Dimension({ number: Math[constant] });
  });
}
