import { toHSL } from '../util/to-hsl.js';
import { Color, defineFunction, Dimension } from '@jesscss/core';

export default defineFunction(
  'saturation',
  function(color: Color) {
    const result = new Dimension({ number: toHSL(color).s * 100, unit: '%' });
    // #region agent log
    fetch('http://127.0.0.1:7246/ingest/5495253d-8cd1-42e7-9850-458424cd0fb8', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Debug-Session-Id': '34ceef'
      },
      body: JSON.stringify({
        sessionId: '34ceef',
        runId: 'hsv-extract-focus',
        hypothesisId: 'H_hsv_2',
        location: 'packages/fns/src/less/saturation.ts:saturation',
        message: 'saturation return node snapshot',
        data: {
          resultType: result.type,
          value: result.value
        },
        timestamp: Date.now()
      })
    }).catch(() => {});
    // #endregion
    return result;
  },
  {
    params: [{
      name: 'color',
      type: Color
    }]
  }
);