import {
  type Context,
  Color,
  Dimension,
  defineFunction,
  ColorFormat
} from '@jesscss/core';
import { syncLog } from '@jesscss/core/debug-log';

const fade = defineFunction(
  'fade',
  function(this: Context, color: Color, amount: Dimension) {
    const newAlpha = amount.value.number / 100;
    const outputFormat = ColorFormat.RGB;
    syncLog({
      fn: 'fade',
      inputFormat: color.value.format ?? null,
      inputAlpha: color._alpha,
      amountNumber: amount.value.number,
      amountUnit: amount.value.unit ?? '',
      outputFormat: outputFormat ?? null,
      outputAlpha: newAlpha
    });

    // Create new color with adjusted alpha, preserving original format
    return new Color({
      format: outputFormat,
      rgb: color._rgb,
      hsl: color._hsl,
      alpha: newAlpha
    }).inherit(color);
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

export default fade;