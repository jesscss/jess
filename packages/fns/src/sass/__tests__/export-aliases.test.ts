import { describe, it, expect } from 'vitest';
import {
  opacify as globalOpacify,
  fadeIn as globalFadeIn,
  transparentize as globalTransparentize,
  fadeOut as globalFadeOut,
  grayscale as globalGrayscale,
  adjustHue as globalAdjustHue,
  ieHexStr as globalIeHexStr
} from '../index.js';
import { grayscale as colorModuleGrayscale, ieHexStr as colorModuleIeHexStr } from '../color/index.js';
import { abs as mathModuleAbs } from '../math/index.js';
import colorRed from '../color/red.js';
import mathAbs from '../math/abs.js';

import fadeinLess from '../../less/fadein.js';
import fadeoutLess from '../../less/fadeout.js';
import greyscaleLess from '../../less/greyscale.js';
import spinLess from '../../less/spin.js';
import argbLess from '../../less/argb.js';
import { red as sharedRed, abs as sharedAbs } from '../../shared/index.js';

describe('Sass export aliases', () => {
  it('maps global Sass wrappers directly to Less implementations', () => {
    expect(globalOpacify).toBe(fadeinLess);
    expect(globalFadeIn).toBe(fadeinLess);
    expect(globalTransparentize).toBe(fadeoutLess);
    expect(globalFadeOut).toBe(fadeoutLess);
    expect(globalGrayscale).toBe(greyscaleLess);
    expect(globalAdjustHue).toBe(spinLess);
    expect(globalIeHexStr).toBe(argbLess);
  });

  it('maps color module exports to expected implementations', () => {
    expect(colorModuleGrayscale).toBe(greyscaleLess);
    expect(colorModuleIeHexStr).toBe(argbLess);
    expect(colorRed).toBe(sharedRed);
  });

  it('maps math module exports to shared implementations', () => {
    expect(mathModuleAbs).toBe(sharedAbs);
    expect(mathAbs).toBe(sharedAbs);
  });
});
