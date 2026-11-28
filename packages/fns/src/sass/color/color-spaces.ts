/**
 * The `sass:color` colour-space functions (Dart Sass 1.101.7,
 * `lib/src/functions/color.dart`): `space`, `to-space`, `is-legacy`,
 * `is-missing`, `is-powerless`, `is-in-gamut`, `channel` and `same`. None has a
 * global spelling. Verified against `sass-spec/spec/core_functions/color/`.
 *
 * Each reads its colour as Dart Sass models one ({@link readColor}), so a
 * `lab()` or `color(display-p3 …)` written in the stylesheet is the colour it
 * names, and its argument errors are Dart Sass's own.
 *
 * HARD MODULE BOUNDARY: value domain only.
 */
import { checkAny, define, isValueGroupArray, makeBool, makeDimension, makeKeyword, optional, type ValueGroup } from '@jesscss/core/value';
import { channelArg, describe, readColor, spaceArg, writeColor, type SpaceColor } from './space-color.js';
import { convertSpace, fuzzyEquals, inGamut, isChannelPowerless, spaceInfo, type SpaceChannels } from './space.js';

const COLOR = { name: 'color', type: 'any', check: checkAny } as const;
const SPACE = /* @__PURE__ */ optional({ name: 'space', type: 'any', check: checkAny });

/** The colour in `$space` when one is given (Dart Sass `_colorInSpace`). */
function inSpace(value: ValueGroup, spaceValue: ValueGroup | undefined, legacyMissing: boolean): SpaceColor {
  const color = readColor(value);
  const space = spaceArg(spaceValue);
  return space === undefined || space === color.space
    ? color
    : { space, channels: convertSpace(color.space, color.channels, space, legacyMissing) };
}

/**
 * The index of a channel the colour's space names, `3` for alpha, or Dart
 * Sass's error, which writes the colour as it was given (`written`) or, converted
 * to `$space`, as it is there.
 */
function channelIndex(color: SpaceColor, name: string, quoteName: boolean, written: ValueGroup | undefined): number {
  if (name === 'alpha') {
    return 3;
  }
  const index = spaceInfo(color.space).channels.findIndex(channel => channel.name === name);
  if (index < 0) {
    const text = written === undefined ? writeColor(color).bytes : describe(written);
    throw new TypeError(quoteName
      ? `$channel: Color ${text} doesn't have a channel named "${name}".`
      : `$channel: Color ${text} has no channel named ${name}.`);
  }
  return index;
}

/** `color.space($color)`: the name of its space, unquoted. */
export const space = define('space', {
  params: [COLOR] as const,
  body: color => makeKeyword(readColor(color).space)
});

/** `color.is-legacy($color)`: whether it is in the rgb, hsl or hwb space. */
export const isLegacy = define('is-legacy', {
  params: [COLOR] as const,
  body: color => makeBool(spaceInfo(readColor(color).space).legacy)
});

/** `color.to-space($color, $space)`: the colour in `$space`, a legacy space's missing channels 0. */
export const toSpace = define('to-space', {
  params: [COLOR, { name: 'space', type: 'any', check: checkAny }] as const,
  body: (value, spaceValue) => {
    const color = readColor(value);
    const dest = spaceArg(spaceValue);
    if (dest === undefined) {
      throw new TypeError('$space: null is not a string.');
    }
    if (dest === color.space && !isValueGroupArray(value) && value.type === 'Color') {
      return value;
    }
    return writeColor({ space: dest, channels: convertSpace(color.space, color.channels, dest, false) });
  }
});

/** `color.channel($color, $channel, $space: null)`: a channel's value, a percentage for a `%` channel and degrees for a hue. */
export const channel = define('channel', {
  params: [COLOR, { name: 'channel', type: 'any', check: checkAny }, SPACE] as const,
  body: (value, channelValue, spaceValue) => {
    const color = inSpace(value, spaceValue, true);
    const name = channelArg(channelValue);
    const index = channelIndex(color, name, false, spaceValue === undefined ? value : undefined);
    const number = color.channels[index] ?? 0;
    if (index === 3) {
      return makeDimension(number);
    }
    const info = spaceInfo(color.space).channels[index]!;
    return info.unit === '%' ? makeDimension(number * 100 / info.max, '%') : makeDimension(number, info.unit);
  }
});

/** `color.is-missing($color, $channel)`: whether the channel is `none`. */
export const isMissing = define('is-missing', {
  params: [COLOR, { name: 'channel', type: 'any', check: checkAny }] as const,
  body: (value, channelValue) => {
    const color = readColor(value);
    return makeBool(color.channels[channelIndex(color, channelArg(channelValue), true, value)] === null);
  }
});

/** `color.is-powerless($color, $channel, $space: null)`: whether the channel has no effect on the colour (css-color-4 §4.4.1). */
export const isPowerless = define('is-powerless', {
  params: [COLOR, { name: 'channel', type: 'any', check: checkAny }, SPACE] as const,
  body: (value, channelValue, spaceValue) => {
    const color = inSpace(value, spaceValue, true);
    const index = channelIndex(color, channelArg(channelValue), true, spaceValue === undefined ? value : undefined);
    return makeBool(index !== 3 && isChannelPowerless(color.space, color.channels, index));
  }
});

/** `color.is-in-gamut($color, $space: null)`: whether the colour lies within the space's gamut. */
export const isInGamut = define('is-in-gamut', {
  params: [COLOR, SPACE] as const,
  body: (value, spaceValue) => {
    const color = inSpace(value, spaceValue, true);
    return makeBool(inGamut(color.space, color.channels));
  }
});

/** `color.same($color1, $color2)`: whether the two are the same colour, compared in XYZ when their spaces differ, a missing channel 0. */
export const same = define('same', {
  params: [{ name: 'color1', type: 'any', check: checkAny }, { name: 'color2', type: 'any', check: checkAny }] as const,
  body: (first, second) => {
    const a = readColor(first, 'color1');
    const b = readColor(second, 'color2');
    const zeroed = ([c0, c1, c2, alpha]: SpaceChannels): SpaceChannels => [c0 ?? 0, c1 ?? 0, c2 ?? 0, alpha ?? 0];
    const x = zeroed(a.space === b.space ? a.channels : convertSpace(a.space, zeroed(a.channels), 'xyz'));
    const y = zeroed(a.space === b.space ? b.channels : convertSpace(b.space, zeroed(b.channels), 'xyz'));
    return makeBool(x.every((n, i) => fuzzyEquals(n ?? 0, y[i] ?? 0)));
  }
});
