import {
  type Context,
  Color,
  Dimension,
  Node,
  defineFunction,
  ColorFormat
} from '@jesscss/core';
import { syncLog } from '@jesscss/core/debug-log';

const fadein = defineFunction(
  'fadein',
  function(this: Context, color: Color, amount: Dimension, method?: Node) {
    let adjustAmount = amount.value.number / 100;

    if (method && method.value === 'relative') {
      adjustAmount = color._alpha * adjustAmount;
    }

    const newAlpha = color._alpha + adjustAmount;
    const outputAlpha = Math.round(newAlpha * 1e12) / 1e12;
    const outputFormat = ColorFormat.RGB;
    syncLog({
      fn: 'fadein',
      inputFormat: color.value.format ?? null,
      inputAlpha: color._alpha,
      amountNumber: amount.value.number,
      amountUnit: amount.value.unit ?? '',
      methodValue: method?.value ?? null,
      outputFormat: outputFormat ?? null,
      outputAlpha
    });

    // Create new color with adjusted alpha, preserving original format
    return new Color({
      format: outputFormat,
      rgb: color._rgb,
      hsl: color._hsl,
      alpha: outputAlpha
    }).inherit(color);
  },
  {
    params: [{
      name: 'color',
      type: Color
    }, {
      name: 'amount',
      type: Dimension
    }, {
      name: 'method',
      type: Node,
      optional: true
    }]
  }
);

export default fadein;