import {
  type Context,
  Color,
  Dimension,
  Node,
  defineFunction,
  ColorFormat
} from '@jesscss/core';
import { syncLog } from '@jesscss/core/debug-log';

const fadeout = defineFunction(
  'fadeout',
  function(this: Context, color: Color, amount: Dimension, method?: Node) {
    let adjustAmount = amount.value.number / 100;

    if (method && method.value === 'relative') {
      adjustAmount = color._alpha * adjustAmount;
    }

    const newAlpha = color._alpha - adjustAmount;
    const outputFormat = ColorFormat.RGB;
    syncLog({
      fn: 'fadeout',
      inputFormat: color.value.format ?? null,
      inputAlpha: color._alpha,
      amountNumber: amount.value.number,
      amountUnit: amount.value.unit ?? '',
      methodValue: method?.value ?? null,
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
    }, {
      name: 'method',
      type: Node,
      optional: true
    }]
  }
);

export default fadeout;