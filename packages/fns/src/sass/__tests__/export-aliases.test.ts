import { describe, it, expect } from 'vitest';
import {
  opacify as globalOpacify,
  fadeIn as globalFadeIn,
  transparentize as globalTransparentize,
  fadeOut as globalFadeOut,
  grayscale as globalGrayscale,
  adjustHue as globalAdjustHue,
  ieHexStr as globalIeHexStr,
  ceil as globalCeil,
  floor as globalFloor,
  round as globalRound
} from '../index.js';
import { grayscale as colorModuleGrayscale, ieHexStr as colorModuleIeHexStr } from '../color/index.js';
import { abs as mathModuleAbs, ceil as mathModuleCeil, floor as mathModuleFloor, round as mathModuleRound } from '../math/index.js';
import colorRed from '../color/red.js';
import mathAbs from '../math/abs.js';

import fadeinLess from '../../less/fadein.js';
import fadeoutLess from '../../less/fadeout.js';
import greyscaleLess from '../../less/greyscale.js';
import spinLess from '../../less/spin.js';
import argbLess from '../../less/argb.js';
import {
  red as sharedRed,
  abs as sharedAbs,
  ceil as sharedCeil,
  floor as sharedFloor
} from '../../shared/index.js';
import lessRound from '../../less/round.js';

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
    expect(mathModuleCeil).toBe(sharedCeil);
    expect(mathModuleFloor).toBe(sharedFloor);
    // `round` is dialect-owned: Sass's second argument is a step, Less's is
    // decimal precision, so the Sass module must NOT be the Less body.
    expect(mathModuleRound).not.toBe(lessRound);
    expect(mathAbs).toBe(sharedAbs);
  });

  it('maps global math exports to the same shared implementations', () => {
    expect(globalCeil).toBe(sharedCeil);
    expect(globalFloor).toBe(sharedFloor);
    expect(globalRound).not.toBe(lessRound);
    expect(globalRound).toBe(mathModuleRound);
  });
});
