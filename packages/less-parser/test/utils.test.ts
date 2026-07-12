import {
  INTERPOLATION_PLACEHOLDER,
  Interpolated,
  InterpolatedSelector,
  co,
  el,
  sel
} from '@jesscss/core';
import { normalizeMixinReferenceKey } from '../src/utils.js';

describe('normalizeMixinReferenceKey', () => {
  it('keeps interpolated selector segments in complex mixin paths', () => {
    const interpolatedName = new Interpolated(
      {
        source: `.${INTERPOLATION_PLACEHOLDER}`,
        replacements: [el('@name')]
      },
      { role: 'ident' }
    );
    const selector = sel([
      el('#ns'),
      co('>'),
      new InterpolatedSelector(interpolatedName)
    ]);

    const { key, rawKey } = normalizeMixinReferenceKey(selector);

    expect(key).toEqual(['#ns', `.${INTERPOLATION_PLACEHOLDER}`]);
    expect(rawKey).toBe(selector);
  });
});
