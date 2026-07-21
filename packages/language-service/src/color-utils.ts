import type { Color as LSPColor, ColorPresentation } from 'vscode-languageserver-types';
import type { CssCstNode } from '@jesscss/css-parser';
import type { TextDocument } from 'vscode-languageserver-textdocument';
import { buildCstIndex } from './cst-analysis.js';

// CSS color keywords map (from CSS Color Module Level 4)
export const colorKeywords: { [name: string]: string } = {
  aliceblue: '#f0f8ff',
  antiquewhite: '#faebd7',
  aqua: '#00ffff',
  aquamarine: '#7fffd4',
  azure: '#f0ffff',
  beige: '#f5f5dc',
  bisque: '#ffe4c4',
  black: '#000000',
  blanchedalmond: '#ffebcd',
  blue: '#0000ff',
  blueviolet: '#8a2be2',
  brown: '#a52a2a',
  burlywood: '#deb887',
  cadetblue: '#5f9ea0',
  chartreuse: '#7fff00',
  chocolate: '#d2691e',
  coral: '#ff7f50',
  cornflowerblue: '#6495ed',
  cornsilk: '#fff8dc',
  crimson: '#dc143c',
  cyan: '#00ffff',
  darkblue: '#00008b',
  darkcyan: '#008b8b',
  darkgoldenrod: '#b8860b',
  darkgray: '#a9a9a9',
  darkgrey: '#a9a9a9',
  darkgreen: '#006400',
  darkkhaki: '#bdb76b',
  darkmagenta: '#8b008b',
  darkolivegreen: '#556b2f',
  darkorange: '#ff8c00',
  darkorchid: '#9932cc',
  darkred: '#8b0000',
  darksalmon: '#e9967a',
  darkseagreen: '#8fbc8f',
  darkslateblue: '#483d8b',
  darkslategray: '#2f4f4f',
  darkslategrey: '#2f4f4f',
  darkturquoise: '#00ced1',
  darkviolet: '#9400d3',
  deeppink: '#ff1493',
  deepskyblue: '#00bfff',
  dimgray: '#696969',
  dimgrey: '#696969',
  dodgerblue: '#1e90ff',
  firebrick: '#b22222',
  floralwhite: '#fffaf0',
  forestgreen: '#228b22',
  fuchsia: '#ff00ff',
  gainsboro: '#dcdcdc',
  ghostwhite: '#f8f8ff',
  gold: '#ffd700',
  goldenrod: '#daa520',
  gray: '#808080',
  grey: '#808080',
  green: '#008000',
  greenyellow: '#adff2f',
  honeydew: '#f0fff0',
  hotpink: '#ff69b4',
  indianred: '#cd5c5c',
  indigo: '#4b0082',
  ivory: '#fffff0',
  khaki: '#f0e68c',
  lavender: '#e6e6fa',
  lavenderblush: '#fff0f5',
  lawngreen: '#7cfc00',
  lemonchiffon: '#fffacd',
  lightblue: '#add8e6',
  lightcoral: '#f08080',
  lightcyan: '#e0ffff',
  lightgoldenrodyellow: '#fafad2',
  lightgray: '#d3d3d3',
  lightgrey: '#d3d3d3',
  lightgreen: '#90ee90',
  lightpink: '#ffb6c1',
  lightsalmon: '#ffa07a',
  lightseagreen: '#20b2aa',
  lightskyblue: '#87cefa',
  lightslategray: '#778899',
  lightslategrey: '#778899',
  lightsteelblue: '#b0c4de',
  lightyellow: '#ffffe0',
  lime: '#00ff00',
  limegreen: '#32cd32',
  linen: '#faf0e6',
  magenta: '#ff00ff',
  maroon: '#800000',
  mediumaquamarine: '#66cdaa',
  mediumblue: '#0000cd',
  mediumorchid: '#ba55d3',
  mediumpurple: '#9370d8',
  mediumseagreen: '#3cb371',
  mediumslateblue: '#7b68ee',
  mediumspringgreen: '#00fa9a',
  mediumturquoise: '#48d1cc',
  mediumvioletred: '#c71585',
  midnightblue: '#191970',
  mintcream: '#f5fffa',
  mistyrose: '#ffe4e1',
  moccasin: '#ffe4b5',
  navajowhite: '#ffdead',
  navy: '#000080',
  oldlace: '#fdf5e6',
  olive: '#808000',
  olivedrab: '#6b8e23',
  orange: '#ffa500',
  orangered: '#ff4500',
  orchid: '#da70d6',
  palegoldenrod: '#eee8aa',
  palegreen: '#98fb98',
  paleturquoise: '#afeeee',
  palevioletred: '#d87093',
  papayawhip: '#ffefd5',
  peachpuff: '#ffdab9',
  peru: '#cd853f',
  pink: '#ffc0cb',
  plum: '#dda0dd',
  powderblue: '#b0e0e6',
  purple: '#800080',
  red: '#ff0000',
  rebeccapurple: '#663399',
  rosybrown: '#bc8f8f',
  royalblue: '#4169e1',
  saddlebrown: '#8b4513',
  salmon: '#fa8072',
  sandybrown: '#f4a460',
  seagreen: '#2e8b57',
  seashell: '#fff5ee',
  sienna: '#a0522d',
  silver: '#c0c0c0',
  skyblue: '#87ceeb',
  slateblue: '#6a5acd',
  slategray: '#708090',
  slategrey: '#708090',
  snow: '#fffafa',
  springgreen: '#00ff7f',
  steelblue: '#4682b4',
  tan: '#d2b48c',
  teal: '#008080',
  thistle: '#d8bfd8',
  tomato: '#ff6347',
  turquoise: '#40e0d0',
  violet: '#ee82ee',
  wheat: '#f5deb3',
  white: '#ffffff',
  whitesmoke: '#f5f5f5',
  yellow: '#ffff00',
  yellowgreen: '#9acd32'
};

export type ParsedColor = {
  red: number;
  green: number;
  blue: number;
  alpha: number;
};

export function colorToLSP(color: ParsedColor): LSPColor {
  return color;
}

function hexColor(text: string): ParsedColor | null {
  const hex = text.startsWith('#') ? text.slice(1) : text;
  if (![3, 4, 6, 8].includes(hex.length) || !/^[0-9a-f]+$/i.test(hex)) {
    return null;
  }
  const pair = (offset: number) => hex.length <= 4
    ? Number.parseInt(hex[offset]! + hex[offset]!, 16)
    : Number.parseInt(hex.slice(offset, offset + 2), 16);
  const alpha = hex.length === 4 ? pair(3) / 255 : hex.length === 8 ? pair(6) / 255 : 1;
  return { red: pair(0) / 255, green: pair(hex.length <= 4 ? 1 : 2) / 255, blue: pair(hex.length <= 4 ? 2 : 4) / 255, alpha };
}

function hslToRgb(hue: number, saturation: number, lightness: number): [number, number, number] {
  const c = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const x = c * (1 - Math.abs((hue / 60) % 2 - 1));
  const m = lightness - c / 2;
  const [r, g, b] = hue < 60 ? [c, x, 0] : hue < 120 ? [x, c, 0] : hue < 180 ? [0, c, x] : hue < 240 ? [0, x, c] : hue < 300 ? [x, 0, c] : [c, 0, x];
  return [r + m, g + m, b + m];
}

function colorFunction(text: string): ParsedColor | null {
  const match = /^(rgb|rgba|hsl|hsla)\((.*)\)$/i.exec(text.trim());
  if (!match) {
    return null;
  }
  const values = match[2]!.split(',').map(value => value.trim());
  if (values.length < 3 || values.some(value => !/^[+-]?(?:\d+\.?\d*|\.\d+)%?$/.test(value))) {
    return null;
  }
  const number = (value: string) => Number.parseFloat(value);
  const fraction = (value: string) => value.endsWith('%') ? number(value) / 100 : number(value);
  const alpha = values[3] ? fraction(values[3]!) : 1;
  if (!Number.isFinite(alpha)) {
    return null;
  }
  if (match[1]!.toLowerCase().startsWith('rgb')) {
    const channel = (value: string) => value.endsWith('%') ? Math.round(fraction(value) * 255) / 255 : number(value) / 255;
    return { red: channel(values[0]!), green: channel(values[1]!), blue: channel(values[2]!), alpha };
  }
  const [red, green, blue] = hslToRgb(((number(values[0]!) % 360) + 360) % 360, fraction(values[1]!), fraction(values[2]!));
  return { red, green, blue, alpha };
}

/**
 * Find statically-known colors through the tolerant CST. Color reporting is an
 * editor feature, so it reads declaration value source ranges rather than asking
 * the compiler to build/evaluate an AST.
 */
export function findColorsInCst(root: CssCstNode, doc: TextDocument): Array<{ start: number; end: number; color: ParsedColor }> {
  const index = buildCstIndex(root);
  const source = doc.getText();
  const found: Array<{ start: number; end: number; color: ParsedColor }> = [];
  const seen = new Set<string>();
  const candidate = /(?:rgba?|hsla?)\([^)]*\)|#[0-9a-fA-F]{3,8}\b|\b[a-zA-Z]+\b/g;
  for (const { node, start, end } of index.nodes) {
    if (node.grammarType !== 'Declaration') {
      continue;
    }
    const valueStart = source.indexOf(':', start);
    if (valueStart < start || valueStart >= end) {
      continue;
    }
    const value = source.slice(valueStart + 1, end);
    let match: RegExpExecArray | null;
    while ((match = candidate.exec(value)) !== null) {
      const text = match[0]!;
      const color = text.startsWith('#')
        ? hexColor(text)
        : colorFunction(text) ?? hexColor(colorKeywords[text.toLowerCase()] ?? '');
      if (!color) {
        continue;
      }
      const from = valueStart + 1 + match.index;
      const to = from + text.length;
      const key = `${from}:${to}`;
      if (!seen.has(key)) {
        seen.add(key);
        found.push({ start: from, end: to, color });
      }
    }
  }
  return found;
}
export function getColorPresentations(color: LSPColor): ColorPresentation[] {
  const presentations: ColorPresentation[] = [];
  const red256 = Math.round(color.red * 255);
  const green256 = Math.round(color.green * 255);
  const blue256 = Math.round(color.blue * 255);

  // RGB/RGBA
  if (color.alpha === 1) {
    presentations.push({
      label: `rgb(${red256}, ${green256}, ${blue256})`,
      textEdit: undefined // Will be set by caller
    });
  } else {
    presentations.push({
      label: `rgba(${red256}, ${green256}, ${blue256}, ${color.alpha})`,
      textEdit: undefined
    });
  }

  // Hex
  if (color.alpha === 1) {
    presentations.push({
      label: `#${toTwoDigitHex(red256)}${toTwoDigitHex(green256)}${toTwoDigitHex(blue256)}`,
      textEdit: undefined
    });
  } else {
    presentations.push({
      label: `#${toTwoDigitHex(red256)}${toTwoDigitHex(green256)}${toTwoDigitHex(blue256)}${toTwoDigitHex(Math.round(color.alpha * 255))}`,
      textEdit: undefined
    });
  }

  // HSL/HSLA
  const hsl = rgbToHSL(color.red, color.green, color.blue);
  if (color.alpha === 1) {
    presentations.push({
      label: `hsl(${Math.round(hsl.h)}, ${Math.round(hsl.s * 100)}%, ${Math.round(hsl.l * 100)}%)`,
      textEdit: undefined
    });
  } else {
    presentations.push({
      label: `hsla(${Math.round(hsl.h)}, ${Math.round(hsl.s * 100)}%, ${Math.round(hsl.l * 100)}%, ${color.alpha})`,
      textEdit: undefined
    });
  }

  // HWB
  const hwb = rgbToHWB(color.red, color.green, color.blue);
  if (color.alpha === 1) {
    presentations.push({
      label: `hwb(${Math.round(hwb.h)} ${Math.round(hwb.w * 100)}% ${Math.round(hwb.b * 100)}%)`,
      textEdit: undefined
    });
  } else {
    presentations.push({
      label: `hwb(${Math.round(hwb.h)} ${Math.round(hwb.w * 100)}% ${Math.round(hwb.b * 100)}% / ${color.alpha})`,
      textEdit: undefined
    });
  }

  // LAB
  const lab = rgbToLAB(color.red, color.green, color.blue);
  if (color.alpha === 1) {
    presentations.push({
      label: `lab(${lab.l.toFixed(1)}% ${lab.a.toFixed(2)} ${lab.b.toFixed(2)})`,
      textEdit: undefined
    });
  } else {
    presentations.push({
      label: `lab(${lab.l.toFixed(1)}% ${lab.a.toFixed(2)} ${lab.b.toFixed(2)} / ${color.alpha})`,
      textEdit: undefined
    });
  }

  // LCH
  const lch = labToLCH(lab);
  if (color.alpha === 1) {
    presentations.push({
      label: `lch(${lch.l.toFixed(1)}% ${lch.c.toFixed(2)} ${lch.h.toFixed(1)})`,
      textEdit: undefined
    });
  } else {
    presentations.push({
      label: `lch(${lch.l.toFixed(1)}% ${lch.c.toFixed(2)} ${lch.h.toFixed(1)} / ${color.alpha})`,
      textEdit: undefined
    });
  }

  // OKLAB
  const oklab = rgbToOKLAB(color.red, color.green, color.blue);
  if (color.alpha === 1) {
    presentations.push({
      label: `oklab(${oklab.l.toFixed(3)} ${oklab.a.toFixed(4)} ${oklab.b.toFixed(4)})`,
      textEdit: undefined
    });
  } else {
    presentations.push({
      label: `oklab(${oklab.l.toFixed(3)} ${oklab.a.toFixed(4)} ${oklab.b.toFixed(4)} / ${color.alpha})`,
      textEdit: undefined
    });
  }

  // OKLCH
  const oklch = labToLCH(oklab);
  if (color.alpha === 1) {
    presentations.push({
      label: `oklch(${oklch.l.toFixed(3)} ${oklch.c.toFixed(4)} ${oklch.h.toFixed(3)})`,
      textEdit: undefined
    });
  } else {
    presentations.push({
      label: `oklch(${oklch.l.toFixed(3)} ${oklch.c.toFixed(4)} ${oklch.h.toFixed(3)} / ${color.alpha})`,
      textEdit: undefined
    });
  }

  return presentations;
}

// Color conversion utilities

function rgbToHSL(r: number, g: number, b: number): { h: number; s: number; l: number } {
  r = Math.max(0, Math.min(1, r));
  g = Math.max(0, Math.min(1, g));
  b = Math.max(0, Math.min(1, b));

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (min + max) / 2;
  const chroma = max - min;

  if (chroma > 0) {
    s = l <= 0.5 ? chroma / (2 * l) : chroma / (2 - 2 * l);

    switch (max) {
      case r:
        h = ((g - b) / chroma + (g < b ? 6 : 0)) / 6;
        break;
      case g:
        h = ((b - r) / chroma + 2) / 6;
        break;
      case b:
        h = ((r - g) / chroma + 4) / 6;
        break;
    }
  }

  return {
    h: h * 360,
    s,
    l
  };
}

function rgbToHWB(r: number, g: number, b: number): { h: number; w: number; b: number } {
  const hsl = rgbToHSL(r, g, b);
  const w = Math.min(r, g, b);
  const black = 1 - Math.max(r, g, b);
  return {
    h: hsl.h,
    w,
    b: black
  };
}

function rgbToXYZ(r: number, g: number, b: number): { x: number; y: number; z: number } {
  // Convert to linear RGB
  const toLinear = (c: number) => {
    c = Math.max(0, Math.min(1, c));
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };

  r = toLinear(r);
  g = toLinear(g);
  b = toLinear(b);

  // Convert to XYZ (D65 illuminant)
  return {
    x: r * 0.4124564 + g * 0.3575761 + b * 0.1804375,
    y: r * 0.2126729 + g * 0.7151522 + b * 0.0721750,
    z: r * 0.0193339 + g * 0.1191920 + b * 0.9503041
  };
}

function xyzToLAB(xyz: { x: number; y: number; z: number }): { l: number; a: number; b: number } {
  const refX = 0.95047;
  const refY = 1.0;
  const refZ = 1.08883;

  const x = xyz.x / refX;
  const y = xyz.y / refY;
  const z = xyz.z / refZ;

  const f = (t: number) => {
    return t > 0.008856 ? Math.pow(t, 1 / 3) : (7.787 * t + 16 / 116);
  };

  const fx = f(x);
  const fy = f(y);
  const fz = f(z);

  return {
    l: 116 * fy - 16,
    a: 500 * (fx - fy),
    b: 200 * (fy - fz)
  };
}

function rgbToLAB(r: number, g: number, b: number): { l: number; a: number; b: number } {
  const xyz = rgbToXYZ(r, g, b);
  return xyzToLAB(xyz);
}

function labToLCH(lab: { l: number; a: number; b: number }): { l: number; c: number; h: number } {
  const c = Math.sqrt(lab.a * lab.a + lab.b * lab.b);
  let h = Math.atan2(lab.b, lab.a) * (180 / Math.PI);
  if (h < 0) {
    h += 360;
  }
  return { l: lab.l, c, h };
}

function rgbToOKLAB(r: number, g: number, b: number): { l: number; a: number; b: number } {
  // Convert to linear RGB
  const toLinear = (c: number) => {
    c = Math.max(0, Math.min(1, c));
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };

  r = toLinear(r);
  g = toLinear(g);
  b = toLinear(b);

  // Convert to XYZ
  const xyz = rgbToXYZ(r, g, b);

  // Convert to LMS
  const l = 0.8189330101 * xyz.x + 0.3618667424 * xyz.y - 0.1288597137 * xyz.z;
  const m = 0.0329845436 * xyz.x + 0.9293118715 * xyz.y + 0.0361456387 * xyz.z;
  const s = 0.0482003018 * xyz.x + 0.2643662691 * xyz.y + 0.6338517070 * xyz.z;

  // Apply non-linearity
  const lCbrt = Math.cbrt(l);
  const mCbrt = Math.cbrt(m);
  const sCbrt = Math.cbrt(s);

  // Convert to OKLab
  return {
    l: 0.2104542553 * lCbrt + 0.7936177850 * mCbrt - 0.0040720468 * sCbrt,
    a: 1.9779984951 * lCbrt - 2.4285922050 * mCbrt + 0.4505937099 * sCbrt,
    b: 0.0259040371 * lCbrt + 0.7827717662 * mCbrt - 0.8086757660 * sCbrt
  };
}
