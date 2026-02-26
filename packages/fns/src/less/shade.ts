import {
  Color,
  ColorFormat,
  Dimension,
  type Context,
  defineFunction
} from '@jesscss/core';
import mix from './mix.js';

const shade = defineFunction(
  'shade',
  function(this: Context, color: Color, amount: Dimension) {
    // #region agent log
    fetch('http://127.0.0.1:7246/ingest/5495253d-8cd1-42e7-9850-458424cd0fb8', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Debug-Session-Id': '34ceef'
      },
      body: JSON.stringify({
        sessionId: '34ceef',
        runId: 'tint-focus',
        hypothesisId: 'H_tint_3',
        location: 'packages/fns/src/less/shade.ts:shade',
        message: 'shade invoked',
        data: {
          amountType: amount.type,
          amountNumber: amount.value.number,
          amountUnit: amount.value.unit ?? ''
        },
        timestamp: Date.now()
      })
    }).catch(() => {});
    // #endregion
    const black = new Color({
      format: ColorFormat.RGB,
      rgb: [0, 0, 0],
      alpha: 1
    });
    const out = mix.call(this, black, color, amount);
    out.value.format = color.value.format;
    if (Math.abs((out.value.alpha ?? 1) - 1) < 1e-12) {
      out.value.alpha = 1;
    }
    return out;
  },
  {
    params: [{
      name: 'color',
      type: Color
    }, {
      name: 'amount',
      type: Dimension
    }]
  }
);

export default shade;