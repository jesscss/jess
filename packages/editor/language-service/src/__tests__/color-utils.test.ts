import { describe, expect, it } from 'vitest';
import { getColorPresentations } from '../color-utils.js';

describe('getColorPresentations', () => {
  it('formats opaque and alpha channels as two-digit hex values', () => {
    const presentations = getColorPresentations({
      red: 1 / 255,
      green: 10 / 255,
      blue: 1,
      alpha: 128 / 255
    });

    expect(presentations.map(({ label }) => label)).toContain('#010aff80');
  });
});
