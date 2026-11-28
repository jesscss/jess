/**
 * The CSS Color 4 colour spaces (css-color-4 §10, §18): their channels, and
 * conversion between any two of them, over plain numbers.
 *
 * A colour in a space is three channels and an alpha, each a number or `null`
 * for a missing (`none`) channel (§4.4). Conversion follows css-color-4 §12:
 * a missing channel reads as 0, and comes back missing when the destination
 * has an analogous channel (§4.4.1: the same rgb-family channel, a lightness, a
 * hue, a chroma or saturation). The matrices, the transfer functions and the
 * order of the steps are Dart Sass 1.101.7's (`lib/src/value/color/space/`),
 * the linear-light matrices composed through XYZ-D65, so `sass:color` computes
 * what Dart Sass computes to the last digit it prints.
 *
 * Full precision throughout (ledger V5): nothing here rounds.
 *
 * HARD MODULE BOUNDARY: numbers only; no value node. Sass's colour-space
 * functions are its one reader, so it lives with them.
 */
import { LINEAR_SRGB_TO_XYZ_D65, srgbToLinear } from '@jesscss/core/value';

export type ColorSpaceName =
  | 'rgb' | 'hsl' | 'hwb'
  | 'srgb' | 'srgb-linear' | 'display-p3' | 'display-p3-linear' | 'a98-rgb' | 'prophoto-rgb' | 'rec2020'
  | 'xyz' | 'xyz-d50' | 'lab' | 'lch' | 'oklab' | 'oklch';

/** Three channels and an alpha; `null` is a missing (`none`) channel. */
export type SpaceChannels = readonly [number | null, number | null, number | null, number | null];

/**
 * One channel of a space. A polar channel is a hue in degrees. A linear one
 * spans `min`–`max`, which a percentage scales to (`50%` of a lab `a` is 62.5),
 * clamps a constructor's argument at a clamped end, and bounds the gamut.
 */
export interface ChannelInfo {
  readonly name: string;
  readonly polar: boolean;
  readonly min: number;
  readonly max: number;
  readonly requiresPercent: boolean;
  readonly lowerClamped: boolean;
  readonly upperClamped: boolean;
  readonly unit: '%' | 'deg' | '';
}

export interface SpaceInfo {
  readonly name: ColorSpaceName;
  readonly channels: readonly [ChannelInfo, ChannelInfo, ChannelInfo];
  readonly legacy: boolean;
  readonly polar: boolean;
  readonly bounded: boolean;
}

type ChannelFlags = Partial<Pick<ChannelInfo, 'requiresPercent' | 'lowerClamped' | 'upperClamped' | 'unit'>>;
const linear = (name: string, min: number, max: number, flags: ChannelFlags = {}): ChannelInfo =>
  ({ name, polar: false, min, max, requiresPercent: flags.requiresPercent ?? false, lowerClamped: flags.lowerClamped ?? false, upperClamped: flags.upperClamped ?? false, unit: flags.unit ?? '' });
const CLAMPED = { lowerClamped: true, upperClamped: true } as const;
const LIGHTNESS = { lowerClamped: true, upperClamped: true, unit: '%' } as const;
const PERCENT = { requiresPercent: true, unit: '%' } as const;
const HUE: ChannelInfo = { name: 'hue', polar: true, min: 0, max: 360, requiresPercent: false, lowerClamped: false, upperClamped: false, unit: 'deg' };
const RGB_UNIT = [linear('red', 0, 1), linear('green', 0, 1), linear('blue', 0, 1)] as const;
const XYZ = [linear('x', 0, 1), linear('y', 0, 1), linear('z', 0, 1)] as const;

const space = (name: ColorSpaceName, channels: SpaceInfo['channels'], legacy: boolean, polar: boolean, bounded: boolean): SpaceInfo =>
  ({ name, channels, legacy, polar, bounded });

let spaces: ReadonlyMap<string, SpaceInfo> | undefined;
const spaceTable = (): ReadonlyMap<string, SpaceInfo> => spaces ??= new Map([
  space('rgb', [linear('red', 0, 255, CLAMPED), linear('green', 0, 255, CLAMPED), linear('blue', 0, 255, CLAMPED)], true, false, true),
  space('hsl', [HUE, linear('saturation', 0, 100, { ...PERCENT, lowerClamped: true }), linear('lightness', 0, 100, PERCENT)], true, true, true),
  space('hwb', [HUE, linear('whiteness', 0, 100, PERCENT), linear('blackness', 0, 100, PERCENT)], true, true, true),
  space('srgb', RGB_UNIT, false, false, true),
  space('srgb-linear', RGB_UNIT, false, false, true),
  space('display-p3', RGB_UNIT, false, false, true),
  space('display-p3-linear', RGB_UNIT, false, false, true),
  space('a98-rgb', RGB_UNIT, false, false, true),
  space('prophoto-rgb', RGB_UNIT, false, false, true),
  space('rec2020', RGB_UNIT, false, false, true),
  space('xyz', XYZ, false, false, false),
  space('xyz-d50', XYZ, false, false, false),
  space('lab', [linear('lightness', 0, 100, LIGHTNESS), linear('a', -125, 125), linear('b', -125, 125)], false, false, false),
  space('lch', [linear('lightness', 0, 100, LIGHTNESS), linear('chroma', 0, 150, { lowerClamped: true }), HUE], false, true, false),
  space('oklab', [linear('lightness', 0, 1, LIGHTNESS), linear('a', -0.4, 0.4), linear('b', -0.4, 0.4)], false, false, false),
  space('oklch', [linear('lightness', 0, 1, LIGHTNESS), linear('chroma', 0, 0.4, { lowerClamped: true }), HUE], false, true, false)
].map(info => [info.name, info]));

/** A space's channels and kind. */
export const spaceInfo = (name: ColorSpaceName): SpaceInfo => spaceTable().get(name)!;

/** The space a name (any case) names, `xyz-d65` being `xyz`, or `undefined`. */
export function colorSpaceNamed(name: string): ColorSpaceName | undefined {
  const lower = name.toLowerCase();
  return spaceTable().get(lower === 'xyz-d65' ? 'xyz' : lower)?.name;
}

/*
 * Dart Sass compares at 10 significant decimal digits: equal within 1e-11, and
 * equal when rounded to 1e-11 (`lib/src/util/number.dart` `fuzzyEquals`).
 */
export function fuzzyEquals(a: number, b: number): boolean {
  return a === b || (Math.abs(a - b) <= 1e-11 && Math.round(a * 1e11) === Math.round(b * 1e11));
}

const mod = (a: number, n: number): number => ((a % n) + n) % n;

// --- linear light -----------------------------------------------------------------------------

type Matrix = readonly number[];

/* Dart Sass 1.101.7's matrices (`lib/src/value/color/conversions.dart`). */
const XYZ_D65_TO_LINEAR_SRGB: Matrix = [3.2409699419045213, -1.5373831775700935, -0.4986107602930033, -0.9692436362808798, 1.8759675015077206, 0.04155505740717561, 0.0556300796969936, -0.20397695888897657, 1.0569715142428786];
const LINEAR_P3_TO_XYZ_D65: Matrix = [0.48657094864821626, 0.26566769316909294, 0.1982172852343625, 0.22897456406974884, 0.6917385218365062, 0.079286914093745, 0, 0.04511338185890257, 1.0439443689009757];
const XYZ_D65_TO_LINEAR_P3: Matrix = [2.4934969119414245, -0.9313836179191236, -0.40271078445071684, -0.8294889695615749, 1.7626640603183468, 0.02362468584194359, 0.03584583024378433, -0.0761723892680417, 0.9568845240076873];
const LINEAR_A98_TO_XYZ_D65: Matrix = [0.5766690429101308, 0.18555823790654627, 0.18822864623499472, 0.29734497525053616, 0.627363566255466, 0.07529145849399789, 0.02703136138641237, 0.07068885253582714, 0.9913375368376389];
const XYZ_D65_TO_LINEAR_A98: Matrix = [2.041587903810746, -0.5650069742788596, -0.3447313507783295, -0.9692436362808798, 1.8759675015077206, 0.04155505740717561, 0.01344428063203102, -0.11836239223101823, 1.0151749943912054];
const LINEAR_REC2020_TO_XYZ_D65: Matrix = [0.6369580483012913, 0.14461690358620838, 0.16888097516417205, 0.26270021201126703, 0.677998071518871, 0.05930171646986194, 0, 0.0280726930490875, 1.0609850577107909];
const XYZ_D65_TO_LINEAR_REC2020: Matrix = [1.7166511879712676, -0.3556707837763924, -0.2533662813736598, -0.666684351832489, 1.616481236634939, 0.01576854581391113, 0.01763985744531091, -0.04277061325780865, 0.942103121235474];
const LINEAR_PROPHOTO_TO_XYZ_D50: Matrix = [0.7977666449006423, 0.13518129740053308, 0.0313477341283922, 0.2880748288194013, 0.711835234241873, 0.00008993693872564, 0, 0, 0.8251046025104602];
const XYZ_D50_TO_LINEAR_PROPHOTO: Matrix = [1.3457868816471583, -0.25557208737979464, -0.05110186497554526, -0.5446307051249019, 1.5082477428451468, 0.02052744743642139, 0, 0, 1.2119675456389452];
const XYZ_D65_TO_XYZ_D50: Matrix = [1.0479297925449966, 0.02294687060160952, -0.05019226628920519, 0.02962780877005567, 0.99043442675388, -0.01707379906341879, -0.00924304064620452, 0.01505519149029816, 0.751874281428137];
const XYZ_D50_TO_XYZ_D65: Matrix = [0.9554734214880752, -0.02309845494876452, 0.06325924320057065, -0.02836970933386358, 1.0099953980813041, 0.0210414411919173, 0.01231401486448199, -0.02050764929889898, 1.330365926242124];
const XYZ_D65_TO_LMS: Matrix = [0.819022437996703, 0.36190626005289034, -0.12887378152098788, 0.03298365393238846, 0.9292868615863433, 0.03614466635064235, 0.0481771893596242, 0.2642395317527308, 0.6335478284694308];
const LMS_TO_XYZ_D65: Matrix = [1.2268798758459243, -0.5578149944602171, 0.2813910456659646, -0.04057574521480084, 1.1122868032803173, -0.07171105806551635, -0.07637293667466007, -0.42149333240224324, 1.5869240198367818];
const LMS_TO_OKLAB: Matrix = [0.210454268309314, 0.7936177747023054, -0.0040720430116193, 1.9779985324311684, -2.42859224204858, 0.450593709617411, 0.0259040424655478, 0.7827717124575296, -0.8086757549230774];
const OKLAB_TO_LMS: Matrix = [1.0000000000000002, 0.3963377773761749, 0.2158037573099136, 0.9999999999999998, -0.10556134581565854, -0.06385417282581334, 0.9999999999999999, -0.0894841775298118, -1.2914855480194094];
const IDENTITY: Matrix = [1, 0, 0, 0, 1, 0, 0, 0, 1];

function multiply(a: Matrix, b: Matrix): Matrix {
  const out: number[] = [];
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      out.push(a[row * 3]! * b[col]! + a[row * 3 + 1]! * b[3 + col]! + a[row * 3 + 2]! * b[6 + col]!);
    }
  }
  return out;
}

/** A space whose channels convert through a linear-light matrix (every space but the polar and lab ones). */
type LinearSpace = 'rgb' | 'srgb' | 'srgb-linear' | 'display-p3' | 'display-p3-linear' | 'a98-rgb' | 'prophoto-rgb' | 'rec2020' | 'xyz' | 'xyz-d50' | 'lms';

/* Each linear space's matrix to and from XYZ-D65, the hub any pair composes through. */
function toXyz(space: LinearSpace): Matrix {
  switch (space) {
    case 'display-p3':
    case 'display-p3-linear': return LINEAR_P3_TO_XYZ_D65;
    case 'a98-rgb': return LINEAR_A98_TO_XYZ_D65;
    case 'prophoto-rgb': return multiply(XYZ_D50_TO_XYZ_D65, LINEAR_PROPHOTO_TO_XYZ_D50);
    case 'rec2020': return LINEAR_REC2020_TO_XYZ_D65;
    case 'xyz': return IDENTITY;
    case 'xyz-d50': return XYZ_D50_TO_XYZ_D65;
    case 'lms': return LMS_TO_XYZ_D65;
    default: return LINEAR_SRGB_TO_XYZ_D65;
  }
}
function fromXyz(space: LinearSpace): Matrix {
  switch (space) {
    case 'display-p3':
    case 'display-p3-linear': return XYZ_D65_TO_LINEAR_P3;
    case 'a98-rgb': return XYZ_D65_TO_LINEAR_A98;
    case 'prophoto-rgb': return multiply(XYZ_D50_TO_LINEAR_PROPHOTO, XYZ_D65_TO_XYZ_D50);
    case 'rec2020': return XYZ_D65_TO_LINEAR_REC2020;
    case 'xyz': return IDENTITY;
    case 'xyz-d50': return XYZ_D65_TO_XYZ_D50;
    case 'lms': return XYZ_D65_TO_LMS;
    default: return XYZ_D65_TO_LINEAR_SRGB;
  }
}

const sign = (v: number): number => (v > 0 ? 1 : v < 0 ? -1 : 0);
const srgbFromLinear = (c: number): number => {
  const abs = Math.abs(c);
  return abs <= 0.0031308 ? c * 12.92 : sign(c) * (1.055 * Math.pow(abs, 1 / 2.4) - 0.055);
};

function toLinear(space: LinearSpace, c: number): number {
  switch (space) {
    case 'rgb': return srgbToLinear(c / 255);
    case 'srgb':
    case 'display-p3': return srgbToLinear(c);
    case 'a98-rgb': return sign(c) * Math.pow(Math.abs(c), 563 / 256);
    case 'prophoto-rgb': {
      const abs = Math.abs(c);
      return abs <= 16 / 512 ? c / 16 : sign(c) * Math.pow(abs, 1.8);
    }
    case 'rec2020': {
      const abs = Math.abs(c);
      return abs < 4.5 * 0.018053968510807 ? c / 4.5 : sign(c) * Math.pow((abs + 1.09929682680944 - 1) / 1.09929682680944, 1 / 0.45);
    }
    default: return c;
  }
}

function fromLinear(space: LinearSpace, c: number): number {
  switch (space) {
    case 'rgb': return srgbFromLinear(c) * 255;
    case 'srgb':
    case 'display-p3': return srgbFromLinear(c);
    case 'a98-rgb': return sign(c) * Math.pow(Math.abs(c), 256 / 563);
    case 'prophoto-rgb': {
      const abs = Math.abs(c);
      return abs >= 1 / 512 ? sign(c) * Math.pow(abs, 1 / 1.8) : 16 * c;
    }
    case 'rec2020': {
      const abs = Math.abs(c);
      return abs > 0.018053968510807 ? sign(c) * (1.09929682680944 * Math.pow(abs, 0.45) - (1.09929682680944 - 1)) : 4.5 * c;
    }
    default: return c;
  }
}

// --- conversion -------------------------------------------------------------------------------

type Missing = { readonly a?: boolean; readonly b?: boolean; readonly chroma?: boolean; readonly hue?: boolean; readonly lightness?: boolean };
type Channel = number | null;
type Result = { readonly space: ColorSpaceName; readonly channels: SpaceChannels };

const result = (dest: ColorSpaceName, c0: Channel, c1: Channel, c2: Channel, alpha: Channel): Result =>
  ({ space: dest, channels: normalize(dest, c0, c1, c2, alpha) });

/*
 * Dart Sass's `SassColor.forSpaceInternal`: a polar space's hue on [0, 360), and
 * a negative saturation or chroma made positive by turning the hue half way.
 */
function normalize(space: ColorSpaceName, c0: Channel, c1: Channel, c2: Channel, alpha: Channel): SpaceChannels {
  const hue = (h: Channel, invert: boolean): Channel => h === null ? null : mod(mod(h, 360) + 360 + (invert ? 180 : 0), 360);
  const inverted = c1 !== null && c1 < 0 && !fuzzyEquals(c1, 0);
  switch (space) {
    case 'hsl': return [hue(c0, inverted), c1 === null ? null : Math.abs(c1), c2, alpha];
    case 'hwb': return [hue(c0, false), c1, c2, alpha];
    case 'lch':
    case 'oklch': return [c0, c1 === null ? null : Math.abs(c1), hue(c2, inverted), alpha];
    default: return [c0, c1, c2, alpha];
  }
}

const or0 = (c: Channel): number => c ?? 0;

function hueToRgb(m1: number, m2: number, hue: number): number {
  if (hue < 0) {
    hue += 1;
  }
  if (hue > 1) {
    hue -= 1;
  }
  if (hue < 1 / 6) {
    return m1 + (m2 - m1) * hue * 6;
  }
  if (hue < 1 / 2) {
    return m2;
  }
  if (hue < 2 / 3) {
    return m1 + (m2 - m1) * (2 / 3 - hue) * 6;
  }
  return m1;
}

function labToLch(dest: ColorSpaceName, [lightness, a, b, alpha]: SpaceChannels, missing: Missing): Result {
  const chroma = Math.sqrt(or0(a) ** 2 + or0(b) ** 2);
  const hue = missing.hue === true || fuzzyEquals(chroma, 0) ? null : Math.atan2(or0(b), or0(a)) * 180 / Math.PI;
  return result(dest, lightness, missing.chroma === true ? null : chroma, hue === null || hue >= 0 ? hue : hue + 360, alpha);
}

/** The hub a destination's channels are reached through, and the steps from it. */
function linearTarget(dest: ColorSpaceName): LinearSpace {
  switch (dest) {
    case 'hsl':
    case 'hwb': return 'srgb';
    case 'lab':
    case 'lch': return 'xyz-d50';
    case 'oklab':
    case 'oklch': return 'lms';
    default: return dest;
  }
}

function convertLinear(from: LinearSpace, dest: ColorSpaceName, [c0, c1, c2, alpha]: SpaceChannels, missing: Missing): Result {
  const target = linearTarget(dest);
  let t0: number;
  let t1: number;
  let t2: number;
  if (target === from) {
    t0 = or0(c0);
    t1 = or0(c1);
    t2 = or0(c2);
  } else {
    const l0 = toLinear(from, or0(c0));
    const l1 = toLinear(from, or0(c1));
    const l2 = toLinear(from, or0(c2));
    const m = multiply(fromXyz(target), toXyz(from));
    t0 = fromLinear(target, m[0]! * l0 + m[1]! * l1 + m[2]! * l2);
    t1 = fromLinear(target, m[3]! * l0 + m[4]! * l1 + m[5]! * l2);
    t2 = fromLinear(target, m[6]! * l0 + m[7]! * l1 + m[8]! * l2);
  }
  switch (dest) {
    case 'hsl':
    case 'hwb': return fromSrgb(dest, [t0, t1, t2, alpha], missing);
    case 'lab':
    case 'lch': return fromXyzD50(dest, [t0, t1, t2, alpha], missing);
    case 'oklab':
    case 'oklch': return fromLms(dest, [t0, t1, t2, alpha], missing);
    default: return result(dest, c0 === null ? null : t0, c1 === null ? null : t1, c2 === null ? null : t2, alpha);
  }
}

/* sRGB on 0–1 to `dest` (Dart Sass `SrgbColorSpace.convert`). */
function fromSrgb(dest: ColorSpaceName, [red, green, blue, alpha]: SpaceChannels, missing: Missing): Result {
  if (dest === 'hsl' || dest === 'hwb') {
    const r = or0(red);
    const g = or0(green);
    const b = or0(blue);
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const delta = max - min;
    let hue = max === min ? 0 : max === r ? 60 * (g - b) / delta + 360 : max === g ? 60 * (b - r) / delta + 120 : 60 * (r - g) / delta + 240;
    if (dest === 'hsl') {
      const lightness = (min + max) / 2;
      let saturation = lightness === 0 || lightness === 1 ? 0 : 100 * (max - lightness) / Math.min(lightness, 1 - lightness);
      if (saturation < 0) {
        hue += 180;
        saturation = Math.abs(saturation);
      }
      return result(dest, missing.hue === true || fuzzyEquals(saturation, 0) ? null : mod(hue, 360), missing.chroma === true ? null : saturation, missing.lightness === true ? null : lightness * 100, alpha);
    }
    const whiteness = min * 100;
    const blackness = 100 - max * 100;
    const grey = missing.hue === true || whiteness + blackness > 100 || fuzzyEquals(whiteness + blackness, 100);
    return result(dest, grey ? null : mod(hue, 360), whiteness, blackness, alpha);
  }
  if (dest === 'rgb') {
    return result(dest, red === null ? null : red * 255, green === null ? null : green * 255, blue === null ? null : blue * 255, alpha);
  }
  if (dest === 'srgb-linear') {
    return result(dest, red === null ? null : srgbToLinear(red), green === null ? null : srgbToLinear(green), blue === null ? null : srgbToLinear(blue), alpha);
  }
  return convertLinear('srgb', dest, [red, green, blue, alpha], missing);
}

const D50_WHITE_X = 0.9642956764295677;
const D50_WHITE_Z = 0.8251046025104602;
const LAB_KAPPA = 24389 / 27;
const LAB_EPSILON = 216 / 24389;

/* XYZ-D50 to `dest` (Dart Sass `XyzD50ColorSpace.convert`). */
function fromXyzD50(dest: ColorSpaceName, [x, y, z, alpha]: SpaceChannels, missing: Missing): Result {
  if (dest === 'lab' || dest === 'lch') {
    const f = (c: number): number => c > LAB_EPSILON ? Math.pow(c, 1 / 3) : (LAB_KAPPA * c + 16) / 116;
    const f0 = f(or0(x) / D50_WHITE_X);
    const f1 = f(or0(y));
    const f2 = f(or0(z) / D50_WHITE_Z);
    const lightness = missing.lightness === true ? null : 116 * f1 - 16;
    const a = 500 * (f0 - f1);
    const b = 200 * (f1 - f2);
    return dest === 'lab'
      ? result(dest, lightness, missing.a === true ? null : a, missing.b === true ? null : b, alpha)
      : labToLch(dest, [lightness, a, b, alpha], missing);
  }
  return convertLinear('xyz-d50', dest, [x, y, z, alpha], missing);
}

/* LMS to `dest` (Dart Sass `LmsColorSpace.convert`). */
function fromLms(dest: ColorSpaceName, [long, medium, short, alpha]: SpaceChannels, missing: Missing): Result {
  if (dest === 'oklab' || dest === 'oklch') {
    const cbrt = (c: Channel): number => Math.pow(Math.abs(or0(c)), 1 / 3) * sign(or0(c));
    const l = cbrt(long);
    const m = cbrt(medium);
    const s = cbrt(short);
    const lightness = missing.lightness === true ? null : LMS_TO_OKLAB[0]! * l + LMS_TO_OKLAB[1]! * m + LMS_TO_OKLAB[2]! * s;
    const a = LMS_TO_OKLAB[3]! * l + LMS_TO_OKLAB[4]! * m + LMS_TO_OKLAB[5]! * s;
    const b = LMS_TO_OKLAB[6]! * l + LMS_TO_OKLAB[7]! * m + LMS_TO_OKLAB[8]! * s;
    return dest === 'oklab'
      ? result(dest, lightness, missing.a === true ? null : a, missing.b === true ? null : b, alpha)
      : labToLch(dest, [lightness, a, b, alpha], missing);
  }
  return convertLinear('lms', dest, [long, medium, short, alpha], missing);
}

/* lab to `dest` (Dart Sass `LabColorSpace.convert`). */
function fromLab(dest: ColorSpaceName, [lightness, a, b, alpha]: SpaceChannels, missing: Missing): Result {
  if (dest === 'lab') {
    const powerless = lightness === null || fuzzyEquals(lightness, 0);
    return result(dest, lightness, a === null || powerless ? null : a, b === null || powerless ? null : b, alpha);
  }
  if (dest === 'lch') {
    return labToLch(dest, [lightness, a, b, alpha], {});
  }
  const l = or0(lightness);
  const f1 = (l + 16) / 116;
  const toXorZ = (c: number): number => {
    const cubed = c ** 3;
    return cubed > LAB_EPSILON ? cubed : (116 * c - 16) / LAB_KAPPA;
  };
  return fromXyzD50(dest, [toXorZ(or0(a) / 500 + f1) * D50_WHITE_X, l > 8 ? Math.pow(f1, 3) : l / LAB_KAPPA, toXorZ(f1 - or0(b) / 200) * D50_WHITE_Z, alpha], { a: a === null, b: b === null, chroma: missing.chroma, hue: missing.hue, lightness: lightness === null });
}

/* oklab to `dest` (Dart Sass `OklabColorSpace.convert`). */
function fromOklab(dest: ColorSpaceName, [lightness, a, b, alpha]: SpaceChannels, missing: Missing): Result {
  if (dest === 'oklch') {
    return labToLch(dest, [lightness, a, b, alpha], missing);
  }
  const l = or0(lightness);
  const aa = or0(a);
  const bb = or0(b);
  const m = OKLAB_TO_LMS;
  return fromLms(dest, [(m[0]! * l + m[1]! * aa + m[2]! * bb) ** 3, (m[3]! * l + m[4]! * aa + m[5]! * bb) ** 3, (m[6]! * l + m[7]! * aa + m[8]! * bb) ** 3, alpha], { a: a === null, b: b === null, chroma: missing.chroma, hue: missing.hue, lightness: lightness === null });
}

/**
 * The colour `(space, channels)` in `dest`. `legacyMissing` false fills a
 * legacy destination's missing channels with 0, as `color.to-space` does
 * (Dart Sass `SassColor.toSpace`).
 */
export function convertSpace(from: ColorSpaceName, channels: SpaceChannels, dest: ColorSpaceName, legacyMissing = true): SpaceChannels {
  if (from === dest) {
    return channels;
  }
  const converted = convert(from, [channels[0], channels[1], channels[2], channels[3] ?? 0], dest).channels;
  if (!legacyMissing && spaceInfo(dest).legacy && converted.some(c => c === null)) {
    return normalize(dest, or0(converted[0]), or0(converted[1]), or0(converted[2]), or0(converted[3]));
  }
  return converted;
}

function convert(from: ColorSpaceName, [c0, c1, c2, alpha]: SpaceChannels, dest: ColorSpaceName): Result {
  switch (from) {
    case 'rgb':
      return fromSrgb(dest, [c0 === null ? null : c0 / 255, c1 === null ? null : c1 / 255, c2 === null ? null : c2 / 255, alpha], {});
    case 'hsl': {
      const h = mod(or0(c0) / 360, 1);
      const s = or0(c1) / 100;
      const l = or0(c2) / 100;
      const m2 = l <= 0.5 ? l * (s + 1) : l + s - l * s;
      const m1 = l * 2 - m2;
      return fromSrgb(dest, [hueToRgb(m1, m2, h + 1 / 3), hueToRgb(m1, m2, h), hueToRgb(m1, m2, h - 1 / 3), alpha], { chroma: c1 === null, hue: c0 === null, lightness: c2 === null });
    }
    case 'hwb': {
      const h = mod(or0(c0), 360) / 360;
      let w = or0(c1) / 100;
      let b = or0(c2) / 100;
      const sum = w + b;
      if (sum > 1) {
        w /= sum;
        b /= sum;
      }
      const factor = 1 - w - b;
      const channel = (hue: number): number => hueToRgb(0, 1, hue) * factor + w;
      return fromSrgb(dest, [channel(h + 1 / 3), channel(h), channel(h - 1 / 3), alpha], { hue: c0 === null });
    }
    case 'srgb':
      return fromSrgb(dest, [c0, c1, c2, alpha], {});
    case 'srgb-linear':
      return dest === 'rgb' || dest === 'srgb' || dest === 'hsl' || dest === 'hwb'
        ? fromSrgb(dest, [c0 === null ? null : srgbFromLinear(c0), c1 === null ? null : srgbFromLinear(c1), c2 === null ? null : srgbFromLinear(c2), alpha], {})
        : convertLinear(from, dest, [c0, c1, c2, alpha], {});
    case 'display-p3':
      return dest === 'display-p3-linear'
        ? result(dest, c0 === null ? null : srgbToLinear(c0), c1 === null ? null : srgbToLinear(c1), c2 === null ? null : srgbToLinear(c2), alpha)
        : convertLinear(from, dest, [c0, c1, c2, alpha], {});
    case 'display-p3-linear':
      return dest === 'display-p3'
        ? result(dest, c0 === null ? null : srgbFromLinear(c0), c1 === null ? null : srgbFromLinear(c1), c2 === null ? null : srgbFromLinear(c2), alpha)
        : convertLinear(from, dest, [c0, c1, c2, alpha], {});
    case 'xyz-d50':
      return fromXyzD50(dest, [c0, c1, c2, alpha], {});
    case 'lab':
      return fromLab(dest, [c0, c1, c2, alpha], {});
    case 'lch': {
      const radians = or0(c2) * Math.PI / 180;
      return fromLab(dest, [c0, or0(c1) * Math.cos(radians), or0(c1) * Math.sin(radians), alpha], { chroma: c1 === null, hue: c2 === null });
    }
    case 'oklab':
      return fromOklab(dest, [c0, c1, c2, alpha], {});
    case 'oklch': {
      const radians = or0(c2) * Math.PI / 180;
      return fromOklab(dest, [c0, or0(c1) * Math.cos(radians), or0(c1) * Math.sin(radians), alpha], { chroma: c1 === null, hue: c2 === null });
    }
    default:
      return convertLinear(from, dest, [c0, c1, c2, alpha], {});
  }
}

// --- channel facts ----------------------------------------------------------------------------

/** Whether a channel of the colour is powerless (css-color-4 §4.4.1): a hue with no saturation or chroma, or a grey's hwb hue. */
export function isChannelPowerless(space: ColorSpaceName, channels: SpaceChannels, index: number): boolean {
  if (index === 0) {
    if (space === 'hsl') {
      return fuzzyEquals(or0(channels[1]), 0);
    }
    if (space === 'hwb') {
      const sum = or0(channels[1]) + or0(channels[2]);
      return sum > 100 || fuzzyEquals(sum, 100);
    }
    return false;
  }
  return index === 2 && (space === 'lch' || space === 'oklch') && fuzzyEquals(or0(channels[1]), 0);
}

/** Whether the colour lies within its space's gamut; an unbounded space has none. */
export function inGamut(space: ColorSpaceName, channels: SpaceChannels): boolean {
  const info = spaceInfo(space);
  if (!info.bounded) {
    return true;
  }
  return info.channels.every((channel, index) => {
    const value = or0(channels[index]!);
    return channel.polar || ((value < channel.max || fuzzyEquals(value, channel.max)) && (value > channel.min || fuzzyEquals(value, channel.min)));
  });
}
