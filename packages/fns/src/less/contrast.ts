import {
  Color,
  ColorFormat,
  type Context,
  Dimension,
  defineFunction
} from '@jesscss/core';
import { toNumber } from '@jesscss/core';
import { syncLog } from '@jesscss/core/debug-log';
import { getLuma } from '../util/get-luma.js';

const contrast = defineFunction(
  'contrast',
  function(this: Context, color: Color, dark?: Color, light?: Color, threshold?: number) {
    if (!light) {
      light = new Color({
        format: ColorFormat.RGB,
        rgb: [255, 255, 255],
        alpha: 1
      });
    }
    if (!dark) {
      dark = new Color({
        format: ColorFormat.RGB,
        rgb: [0, 0, 0],
        alpha: 1
      });
    }
    // Figure out which is actually light and dark:
    if (getLuma(dark!) > getLuma(light!)) {
      const t = light;
      light = dark;
      dark = t;
    }
    let thresholdNum: number;
    if (!threshold) {
      thresholdNum = 0.43;
    } else {
      thresholdNum = threshold;
    }
    const out = getLuma(color) < thresholdNum ? light : dark;
    out!.value.format = color.value.format;
    // #region agent log
    const payload = {
      sessionId: '34ceef',
      runId: 'color-format-propagation',
      hypothesisId: 'H_color_4',
      location: 'packages/fns/src/less/contrast.ts:contrast',
      message: 'contrast format propagation',
      data: {
        inputFormat: color.value.format ?? null,
        selectedLuma: getLuma(color),
        threshold: thresholdNum,
        outputFormat: out!.value.format ?? null
      },
      timestamp: Date.now()
    };
    syncLog(payload);
    fetch('http://127.0.0.1:7246/ingest/5495253d-8cd1-42e7-9850-458424cd0fb8', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Debug-Session-Id': '34ceef'
      },
      body: JSON.stringify(payload)
    }).catch(() => {});
    // #endregion
    return out;
  },
  {
    params: [{
      name: 'color',
      type: Color
    }, {
      name: 'dark',
      type: Color,
      optional: true
    }, {
      name: 'light',
      type: Color,
      optional: true
    }, {
      name: 'threshold',
      type: Dimension,
      convert: [toNumber()],
      optional: true
    }]
  }
);

export default contrast;