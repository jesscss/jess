import {
  Color,
  type Context,
  defineFunction
} from '@jesscss/core';

const greyscale = defineFunction(
  'greyscale',
  function(this: Context, color: Color) {
    const [h, , l] = color._hsl;
    const result = new Color({
      format: color.value.format,
      hsl: [h, 0, l],
      alpha: color._alpha
    }).inherit(color);
    // #region agent log
    fetch('http://127.0.0.1:7246/ingest/5495253d-8cd1-42e7-9850-458424cd0fb8', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Debug-Session-Id': '34ceef'
      },
      body: JSON.stringify({
        sessionId: '34ceef',
        runId: 'greyscale-focus',
        hypothesisId: 'H_grey_2',
        location: 'packages/fns/src/less/greyscale.ts:greyscale',
        message: 'greyscale call snapshot',
        data: {
          inputHsl: color._hsl.join(','),
          outputType: (result as any)?.type ?? typeof result,
          outputHsl: (result as any)?._hsl?.join?.(',') ?? null
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

export default greyscale;