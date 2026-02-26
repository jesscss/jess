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
      const result = mathHelper(Math[method], ['value'], outputUnit, value);
      // #region agent log
      fetch('http://127.0.0.1:7246/ingest/5495253d-8cd1-42e7-9850-458424cd0fb8', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Debug-Session-Id': '34ceef'
        },
        body: JSON.stringify({
          sessionId: '34ceef',
          runId: 'math-factory',
          hypothesisId: 'HMF1',
          location: 'packages/fns/src/less/math-factory.ts:defineUnaryMathFunction',
          message: 'Math wrapper invocation',
          data: {
            name,
            method,
            inputKind: value instanceof Dimension ? 'dimension' : 'number',
            inputUnit: value instanceof Dimension ? value.value.unit : undefined,
            outputUnit,
            resultType: result.type
          },
          timestamp: Date.now()
        })
      }).catch(() => {});
      // #endregion
      return result;
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
