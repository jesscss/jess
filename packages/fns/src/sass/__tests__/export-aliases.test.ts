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
import {
  grayscale as colorModuleGrayscale,
  ieHexStr as colorModuleIeHexStr,
  red as colorModuleRed
} from '../color/index.js';
import { abs as mathModuleAbs, ceil as mathModuleCeil, floor as mathModuleFloor, round as mathModuleRound } from '../math/index.js';
import mathAbs from '../math/abs.js';

import { fadein as fadeinLess } from '../../less/fadein.js';
import { fadeout as fadeoutLess } from '../../less/fadeout.js';
import { greyscale as greyscaleLess } from '../../less/greyscale.js';
import { spin as spinLess } from '../../less/spin.js';
import { argb as argbLess } from '../../less/argb.js';
import {
  red as sharedRed,
  abs as sharedAbs,
  ceil as sharedCeil,
  floor as sharedFloor
} from '../../shared/index.js';
import lessRound from '../../less/round.js';

describe('Sass export aliases', () => {
  // These previously asserted the OPPOSITE — that the Sass globals simply WERE
  // the Less callables. That was the bug, not the contract: `fade-in`/`fade-out`
  // use a 0-1 amount where Less's `fadein`/`fadeout` use a percentage, and
  // `ie-hex-str` emits upper-case hex where `argb` emits lower case
  // (see `color-wrappers.test.ts` for the disproofs). `grayscale`/`adjust-hue`
  // do share a computation with `greyscale`/`spin`, but a fn IS its dispatch
  // name, so a Sass module still owns its own definition.
  it('never borrows a Less colour implementation', () => {
    for (const fn of [globalOpacify, globalFadeIn]) {
      expect(fn).not.toBe(fadeinLess);
    }
    for (const fn of [globalTransparentize, globalFadeOut]) {
      expect(fn).not.toBe(fadeoutLess);
    }
    expect(globalGrayscale).not.toBe(greyscaleLess);
    expect(globalAdjustHue).not.toBe(spinLess);
    expect(globalIeHexStr).not.toBe(argbLess);
  });

  it('registers every colour global under its SASS dispatch name', () => {
    expect([
      globalOpacify.name,
      globalFadeIn.name,
      globalTransparentize.name,
      globalFadeOut.name,
      globalGrayscale.name,
      globalAdjustHue.name,
      globalIeHexStr.name
    ]).toEqual(['opacify', 'fade-in', 'transparentize', 'fade-out', 'grayscale', 'adjust-hue', 'ie-hex-str']);
  });

  it('serves the sass:color module and the global surface the same callables', () => {
    expect(colorModuleGrayscale).toBe(globalGrayscale);
    expect(colorModuleIeHexStr).toBe(globalIeHexStr);
    // `red`/`green`/`blue`/`alpha` DO stay shared: under the colour-precision
    // ruling the two dialects' channel readers are the same function.
    expect(colorModuleRed).toBe(sharedRed);
  });

  it('maps math module exports to shared implementations', () => {
    expect(mathModuleAbs).toBe(sharedAbs);
    expect(mathModuleCeil).toBe(sharedCeil);
    expect(mathModuleFloor).toBe(sharedFloor);

    /*
     * `round` is dialect-owned: Sass's second argument is a step, Less's is
     * decimal precision, so the Sass module must NOT be the Less body.
     */
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
