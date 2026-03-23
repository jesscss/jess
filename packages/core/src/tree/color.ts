import { Node, F_STATIC, defineType, type NodeOptions, type LocationInfo, type TreeContext } from './node.js';
import { calculate, type Operator } from './util/calculate.js';
import { type Context } from '../context.js';
import { isNode } from './util/is-node.js';
import { N } from './node-type.js';
import round from 'lodash-es/round.js';
import { type PrintOptions, getPrintOptions } from './util/print.js';
type ColorValues = [number, number, number, number] | number[];
type ChannelTuple = [number, string];
type ChannelValue = number | ChannelTuple;
type AlphaValue = number | ChannelTuple;
type RGBChannels = [ChannelValue, ChannelValue, ChannelValue];
type HSLChannels = [ChannelValue, ChannelValue, ChannelValue];

export enum ColorFormat {
  HEX,
  RGB,
  HSL
}

function clamp(v: number, max: number) {
  return Math.min(Math.max(v, 0), max);
}

function parseHexString(hex: string): { rgb: [number, number, number]; alpha: number } {
  let rgba: number[] = [];
  let hexValue = hex.slice(1);

  if (hexValue.length >= 6) {
    (hexValue.match(/.{2}/g) as RegExpMatchArray).forEach((c, i) => {
      if (i < 3) {
        rgba.push(parseInt(c, 16));
      } else {
        rgba.push(parseInt(c, 16) / 255);
      }
    });
  } else {
    hexValue.split('').forEach((c, i) => {
      if (i < 3) {
        rgba.push(parseInt(c + c, 16));
      } else {
        rgba.push(parseInt(c + c, 16) / 255);
      }
    });
  }

  return {
    rgb: [rgba[0]!, rgba[1]!, rgba[2]!] as [number, number, number],
    alpha: rgba.length === 3 ? 1 : rgba[3]!
  };
}

const { isArray } = Array;

export interface ColorData {
  node?: string | Node;
  /** Legacy field; format now lives on Color options. */
  format?: ColorFormat;
  rgb?: RGBChannels;
  hsl?: HSLChannels;
  alpha?: AlphaValue;
}

export interface ColorOptions extends NodeOptions {
  format?: ColorFormat;
  modernSyntax?: boolean;
}

export interface Color extends Node<ColorData, ColorOptions> {
  type: 'Color';
  shortType: 'color';
  eval(context: Context): Color;
}

/**
 * Color's `value` will store RGB, HSL, and alpha separately to avoid unnecessary conversions.
 * Conversion only happens when modifying colors or when explicitly requested.
 */
export class Color extends Node<ColorData, ColorOptions> {
  static override childKeys = null as null;

  _rgbChannels: RGBChannels | undefined;
  _hslChannels: HSLChannels | undefined;
  _alphaValue: AlphaValue | undefined;
  _nodeValue: string | Node | undefined;

  constructor(
    value: ColorData | string | ColorValues,
    options?: ColorOptions,
    location?: LocationInfo,
    context?: TreeContext
  ) {
    let colorData: ColorData;
    let colorOptions: ColorOptions = options ?? {};

    if (isArray(value)) {
      // Handle color array [r, g, b, a]
      const [r, g, b, a] = value as [number, number, number, number];
      colorData = {
        rgb: [r, g, b],
        alpha: a
      };
      colorOptions = { ...colorOptions, format: colorOptions.format ?? ColorFormat.RGB };
    } else if (typeof value === 'object' && value !== null && !isNode(value)) {
      // Handle ColorData object
      colorData = value as ColorData;

      // Validate that we have either rgb, hsl, or a node to parse
      if (!colorData.rgb && !colorData.hsl && !colorData.node) {
        throw new TypeError('Color constructor requires rgb, hsl, or node property');
      }
      if (colorData.format !== undefined && colorOptions.format === undefined) {
        colorOptions = { ...colorOptions, format: colorData.format };
      }
    } else if (typeof value === 'string') {
      // Handle hex string - parse it immediately to set RGB values
      const { rgb, alpha } = parseHexString(value);
      colorData = {
        node: value,
        rgb,
        alpha
      };
      colorOptions = { ...colorOptions, format: colorOptions.format ?? ColorFormat.HEX };
    } else {
      throw new TypeError('Color constructor requires ColorData object, hex string, or color array');
    }

    // Keep value focused on channels/node; rendering intent is held in options.
    colorData.format = undefined;
    super(colorData as any, colorOptions, location, context);
    this._rgbChannels = colorData.rgb;
    this._hslChannels = colorData.hsl;
    this._alphaValue = colorData.alpha;
    this._nodeValue = colorData.node;
    this.addFlag(F_STATIC);
  }

  override clone(deep?: boolean): this {
    const options = (this as any)._meta?.options;
    const colorData: any = {
      node: this._nodeValue,
      rgb: this._rgbChannels ? [...this._rgbChannels] : undefined,
      hsl: this._hslChannels ? [...this._hslChannels] : undefined,
      alpha: this._alphaValue
    };
    const newNode = new (this.constructor as any)(
      colorData,
      options ? { ...options } : undefined,
      this.location,
      this.treeContext
    );
    newNode.inherit(this);
    return newNode;
  }

  override compare(b: Node, context?: Context): 0 | 1 | -1 | undefined {
    if (!(b instanceof Color)) {
      return super.compare(b, context);
    }

    const aRgba = [...this._rgb, this._alpha] as const;
    const bRgba = [...b._rgb, b._alpha] as const;

    for (let i = 0; i < aRgba.length; i++) {
      const cmp = Node.numericCompare(aRgba[i]!, bRgba[i]!);
      if (cmp !== 0) {
        return cmp;
      }
    }

    return 0;
  }

  private normalizeChannelValue(value: unknown): ChannelValue {
    if (typeof value === 'number') {
      return value;
    }
    if (isNode(value, N.Dimension)) {
      const { number, unit } = value;
      return unit ? [number, unit] : number;
    }
    return value as ChannelValue;
  }

  private hueToDegrees(value: ChannelValue): number {
    value = this.normalizeChannelValue(value) as ChannelValue;
    if (typeof value === 'number') {
      return value;
    }
    const [number, unit] = value;
    switch (unit) {
      case 'turn':
        return number * 360;
      case 'rad':
        return number * (180 / Math.PI);
      case 'grad':
        return number * 0.9;
      default:
        return number;
    }
  }

  private percentToUnit(value: ChannelValue): number {
    value = this.normalizeChannelValue(value) as ChannelValue;
    if (typeof value === 'number') {
      return value;
    }
    const [number, unit] = value;
    return unit === '%' ? number / 100 : number;
  }

  private rgbChannelToNumber(value: ChannelValue): number {
    value = this.normalizeChannelValue(value) as ChannelValue;
    if (typeof value === 'number') {
      return value;
    }
    const [number, unit] = value;
    return unit === '%' ? (number * 255) / 100 : number;
  }

  private alphaToNumber(value: AlphaValue): number {
    value = this.normalizeChannelValue(value) as AlphaValue;
    if (typeof value === 'number') {
      return value;
    }
    const [number, unit] = value;
    return unit === '%' ? number / 100 : number;
  }

  private getSerializedAlphaText(compress: boolean): string {
    const alphaSource = this._alphaValue;
    if (compress && this.alpha === 0) {
      return '0';
    }
    const normalizedAlphaSource = this.normalizeChannelValue(alphaSource) as AlphaValue;
    if (Array.isArray(normalizedAlphaSource)) {
      const [alphaValue, alphaUnit] = normalizedAlphaSource;
      return `${round(alphaValue, 8)}${alphaUnit}`;
    }
    return `${this.alpha}`;
  }

  private getSerializedRgbText(): [string, string, string] {
    const rgbSource = this._rgbChannels;
    if (!rgbSource) {
      const [r, g, b] = this.rgb;
      return [`${r}`, `${g}`, `${b}`];
    }
    return rgbSource.map((channel, idx) => {
      channel = this.normalizeChannelValue(channel) as ChannelValue;
      if (typeof channel === 'number') {
        return `${this.rgb[idx]!}`;
      }
      const [number, unit] = channel;
      if (unit === '%') {
        return `${round(clamp(number, 100), 8)}%`;
      }
      return `${this.rgb[idx]!}`;
    }) as [string, string, string];
  }

  /**
   * Get RGB values, converting from HSL if needed.
   * Returns clamped values (0-255) for better developer experience.
   * For internal calculations, use _rgb instead.
   */
  get rgb(): [number, number, number] {
    const [r, g, b] = this._rgb;
    return [
      clamp(round(r), 255),
      clamp(round(g), 255),
      clamp(round(b), 255)
    ];
  }

  /**
   * Internal getter for unclamped RGB values.
   * Use this for calculations and conversions.
   */
  get _rgb(): [number, number, number] {
    if (this._rgbChannels) {
      const [r, g, b] = this._rgbChannels;
      return [
        this.rgbChannelToNumber(r),
        this.rgbChannelToNumber(g),
        this.rgbChannelToNumber(b)
      ];
    }

    if (this._hslChannels) {
      // Convert HSL to RGB
      const [h, s, l] = this._hslChannels;
      const hue = this.hueToDegrees(h) / 360;
      const sat = this.percentToUnit(s);
      const light = this.percentToUnit(l);

      let r, g, b;

      if (sat === 0) {
        r = g = b = light;
      } else {
        const hue2rgb = (p: number, q: number, t: number) => {
          if (t < 0) {
            t += 1;
          }
          if (t > 1) {
            t -= 1;
          }
          if (t < 1 / 6) {
            return p + (q - p) * 6 * t;
          }
          if (t < 1 / 2) {
            return q;
          }
          if (t < 2 / 3) {
            return p + (q - p) * (2 / 3 - t) * 6;
          }
          return p;
        };

        const q = light < 0.5 ? light * (1 + sat) : light + sat - light * sat;
        const p = 2 * light - q;

        r = hue2rgb(p, q, hue + 1 / 3);
        g = hue2rgb(p, q, hue);
        b = hue2rgb(p, q, hue - 1 / 3);
      }

      // Convert from 0-1 to 0-255 range
      const rgb = [r * 255, g * 255, b * 255] as [number, number, number];
      this._rgbChannels = rgb;
      this._hslChannels = undefined;
      return rgb;
    }

    // If value has a node that's a string, parse it as hex
    if (this._nodeValue && typeof this._nodeValue === 'string') {
      const { rgb, alpha } = parseHexString(this._nodeValue);
      this._rgbChannels = rgb;
      this._alphaValue = alpha;
      this._hslChannels = undefined;
      return rgb;
    }

    throw new TypeError('Cannot convert color value to rgb');
  }

  set rgb(rgb: [number, number, number] | RGBChannels) {
    this._rgbChannels = rgb;
    this._hslChannels = undefined;
  }

  /**
   * Get HSL values, converting from RGB if needed.
   * Returns clamped values (hue: 0-360, saturation/lightness: 0-1) for better developer experience.
   * For internal calculations, use _hsl instead.
   */
  get hsl(): [number, number, number] {
    const [h, s, l] = this._hsl;
    return [
      ((h % 360) + 360) % 360, // Wrap hue to 0-360
      clamp(s, 1), // Clamp saturation to 0-1
      clamp(l, 1)  // Clamp lightness to 0-1
    ];
  }

  /**
   * Internal getter for unclamped HSL values.
   * Use this for calculations and conversions.
   */
  get _hsl(): [number, number, number] {
    if (this._hslChannels) {
      const [h, s, l] = this._hslChannels;
      return [
        this.hueToDegrees(h),
        this.percentToUnit(s),
        this.percentToUnit(l)
      ];
    }

    // Convert RGB to HSL
    let [r, g, b] = this._rgb;
    // Convert RGB from 0-255 range to 0-1 range for HSL calculation
    r = r / 255;
    g = g / 255;
    b = b / 255;

    let max = Math.max(r, g, b);
    let min = Math.min(r, g, b);
    let h: number;
    let s: number;
    let l = (max + min) / 2;

    if (max === min) {
      h = s = 0;
    } else {
      let d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      switch (max) {
        case r: {
          h = (g - b) / d + (g < b ? 6 : 0);
          break;
        }
        case g: {
          h = (b - r) / d + 2;
          break;
        }
        case b: {
          h = (r - g) / d + 4;
          break;
        }
      }
      h! /= 6;
    }

    const hsl = [h! * 360, s, l] as [number, number, number];
    this._hslChannels = hsl;
    this._rgbChannels = undefined;
    return hsl;
  }

  set hsl(hsl: [number, number, number] | HSLChannels) {
    this._hslChannels = hsl;
    this._rgbChannels = undefined;
  }

  /**
   * Get alpha value.
   * Returns clamped value (0-1) for better developer experience.
   * For internal calculations, use _alpha instead.
   */
  get alpha(): number {
    return clamp(this._alpha, 1);
  }

  /**
   * Internal getter for unclamped alpha value.
   * Use this for calculations and conversions.
   */
  get _alpha(): number {
    const alpha = this._alphaValue ?? 1;
    return this.alphaToNumber(alpha);
  }

  set alpha(alpha: AlphaValue) {
    this._alphaValue = alpha;
  }

  /**
   * Get RGBA values for backward compatibility.
   * Returns clamped values for better developer experience.
   */
  get rgba(): ColorValues {
    return [...this.rgb, this.alpha];
  }

  set rgba(rgba: ColorValues) {
    const [r, g, b, a] = rgba as [number, number, number, number];
    this._rgbChannels = [r, g, b];
    this._alphaValue = a;
    this._hslChannels = undefined;
  }

  /**
   * Get HSLA values for backward compatibility.
   * Returns clamped values for better developer experience.
   */
  get hsla(): [number, number, number, number] {
    return [...this.hsl, this.alpha];
  }

  set hsla(hsla: [number, number, number, number]) {
    const [h, s, l, a] = hsla;
    this._hslChannels = [h, s, l];
    this._alphaValue = a;
    this._rgbChannels = undefined;
  }

  toHSL(): [number, number, number] {
    return this.hsl;
  }

  toHex(): string {
    const values = this.rgb;
    let alpha = this.alpha;
    if (alpha < 1) {
      values.push(round(alpha * 255));
    }
    let hex = '#' + values.map(function(c) {
      let hex = c.toString(16);
      return hex.length === 1 ? '0' + hex : hex;
    }).join('');
    return hex;
  }

  override toTrimmedString(options?: PrintOptions) {
    options = getPrintOptions(options);
    const w = options.writer!;
    const mark = w.mark();
    const compress = Boolean(options.compress);

    // If value has a node that's a Node, serialize it directly
    if (this._nodeValue && isNode(this._nodeValue)) {
      return this._nodeValue.toTrimmedString(options);
    }

    // If value has a node that's a string, output it as-is
    if (this._nodeValue && typeof this._nodeValue === 'string') {
      w.add(this._nodeValue, this);
      return w.getSince(mark);
    }

    // Handle format-based serialization
    const format = this.options.format ?? ColorFormat.HEX;
    if (format === ColorFormat.RGB) {
      const useModernSyntax = Boolean(this.options.modernSyntax || compress);
      const rgbText = this.getSerializedRgbText();
      const alphaText = this.getSerializedAlphaText(compress);
      if (useModernSyntax) {
        if (this.alpha < 1) {
          w.add('rgb(', this);
          w.add(`${rgbText[0]} ${rgbText[1]} ${rgbText[2]} / ${alphaText}`);
          w.add(')');
        } else {
          w.add('rgb(', this);
          w.add(`${rgbText[0]} ${rgbText[1]} ${rgbText[2]}`);
          w.add(')');
        }
      } else {
        if (this.alpha < 1) {
          w.add('rgba(', this);
          w.add(`${rgbText[0]}, ${rgbText[1]}, ${rgbText[2]}, ${alphaText}`);
          w.add(')');
        } else {
          w.add('rgb(', this);
          w.add(`${rgbText[0]}, ${rgbText[1]}, ${rgbText[2]}`);
          w.add(')');
        }
      }
      return w.getSince(mark);
    } else if (format === ColorFormat.HSL) {
      const [h, s, l] = this.hsl;
      const hueSource = this._hslChannels?.[0];
      const alphaText = this.getSerializedAlphaText(compress);
      const authoredHueUnit = Array.isArray(hueSource) ? hueSource[1] : '';
      const roundedHue = round(h, 8);
      const canDropHueUnitForCompression = compress && roundedHue === 0;
      const modernHueUnit = canDropHueUnitForCompression
        ? ''
        : (authoredHueUnit || 'deg');
      const preservedHueUnit = canDropHueUnitForCompression ? '' : authoredHueUnit;
      const useModernSyntax = Boolean(this.options.modernSyntax || compress);
      if (useModernSyntax) {
        if (this.alpha < 1) {
          w.add('hsl(', this);
          w.add(`${roundedHue}${modernHueUnit} ${round(s * 100, 8)}% ${round(l * 100, 8)}% / ${alphaText}`);
          w.add(')');
        } else {
          w.add('hsl(', this);
          w.add(`${roundedHue}${modernHueUnit} ${round(s * 100, 8)}% ${round(l * 100, 8)}%`);
          w.add(')');
        }
      } else {
        if (this.alpha < 1) {
          w.add('hsla(', this);
          w.add(`${roundedHue}${preservedHueUnit}, ${round(s * 100, 8)}%, ${round(l * 100, 8)}%, ${alphaText}`);
          w.add(')');
        } else {
          w.add('hsl(', this);
          w.add(`${roundedHue}${preservedHueUnit}, ${round(s * 100, 8)}%, ${round(l * 100, 8)}%`);
          w.add(')');
        }
      }
      return w.getSince(mark);
    }

    // Default to hex
    w.add(this.toHex(), this);
    return w.getSince(mark);
  }

  override operate(b: Node, op: Operator, context?: Context | undefined): Color {
    let aRGB = this._rgb;
    let newColorValues: [number, number, number];
    let newAlpha = this._alpha;

    if (isNode(b, N.Dimension)) {
      const { number: bVal, unit: bUnit } = b;
      const unitMode = context?.opts?.unitMode ?? 'loose';
      const isStrictLikeMode = unitMode === 'strict' || unitMode === 'preserve';
      if (bUnit && isStrictLikeMode) {
        throw new TypeError(`Cannot convert "${b}" to a color`);
      }
      // Apply operation to each RGB component with the number
      newColorValues = aRGB.map(a => calculate(a, op, bVal)) as [number, number, number];
    } else if (b instanceof Color) {
      // Color-to-color operation
      let bRGB = b._rgb;
      newColorValues = aRGB.map((a, i) => calculate(a, op, bRGB[i]!)) as [number, number, number];
      newAlpha = this._alpha * (1 - b._alpha) + b._alpha;
    } else {
      throw new TypeError(`Cannot operate on ${b.type}`);
    }

    // Create new color with preserved data
    const newColor = new Color({
      rgb: newColorValues,
      alpha: newAlpha
      // Don't preserve HSL - new RGB values represent a new color
    }, {
      format: this.options.format,
      modernSyntax: this.options.modernSyntax
    }).inherit(this);

    return newColor;
  }
}

export const color = defineType(Color, 'Color');
