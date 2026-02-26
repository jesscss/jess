import { Color } from '@jesscss/core';
import { syncLog } from '@jesscss/core/debug-log';

// Color Blending
// ref: http://www.w3.org/TR/compositing-1
export function colorBlend(mode: (c1: number, c2: number) => number, color1: Color, color2: Color) {
  if (!(color1 instanceof Color) || !(color2 instanceof Color)) {
    throw new Error('Both arguments must be colors.');
  }
  // result
  const ab = color1.alpha;

  let cb: number; // backdrop
  let cs: number; // source
  const as = color2.alpha;

  let cr: number;
  const rgba: number[] = [];

  const ar = as + ab * (1 - as);
  for (let i = 0; i < 3; i++) {
    cb = color1.rgb[i]! / 255;
    cs = color2.rgb[i]! / 255;
    cr = mode(cb, cs);
    if (ar) {
      cr = (as * cs + ab * (cb
        - as * (cb + cs - cr))) / ar;
    }
    rgba[i] = cr * 255;
  }
  rgba[3] = ar;

  const out = new Color(rgba);
  // Preserve color1 style for blend outputs (Less-like form continuity).
  out.value.format = color1.value.format;
  // #region agent log
  const payload = {
    sessionId: '34ceef',
    runId: 'color-format-propagation',
    hypothesisId: 'H_color_2',
    location: 'packages/fns/src/util/colorHelper.ts:colorBlend',
    message: 'colorBlend format propagation',
    data: {
      input1Format: color1.value.format ?? null,
      input2Format: color2.value.format ?? null,
      outputFormat: out.value.format ?? null
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
}