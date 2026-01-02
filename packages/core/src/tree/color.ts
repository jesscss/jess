import { Node, defineType } from './node';
import { calculate, type Operator } from './util/calculate';
import { type Context } from '../context';
import { isNode } from './util/is-node';
import round from 'lodash-es/round';
import { type PrintOptions, getPrintOptions } from './util/print.js';
import { Call } from './call';
import { List } from './list';

type ColorValues = [number, number, number, number] | number[];

export enum ColorFormat {
  HEX,
  RGB,
  HSL
}

function clamp(v: number, max: number) {
  return Math.min(Math.max(v, 0), max);
}

const { isArray } = Array;

export interface ColorData {
  node?: string | Node;
  format?: ColorFormat;
  rgb?: [number, number, number];
  hsl?: [number, number, number];
  alpha?: number;
}

export interface Color extends Node<ColorData> {
  eval(context: Context): Color;
}

/**
 * Color's `value` will store RGB, HSL, and alpha separately to avoid unnecessary conversions.
 * Conversion only happens when modifying colors or when explicitly requested.
 */
export class Color extends Node<ColorData> {
  type = 'Color' as const;
  shortType = 'color' as const;
  // Color values are static and don't need evaluation

  constructor(
    value: ColorData | string | ColorValues,
    options?: ConstructorParameters<typeof Node<ColorData>>[1],
    location?: ConstructorParameters<typeof Node<ColorData>>[2],
    context?: ConstructorParameters<typeof Node<ColorData>>[3]
  ) {
    let colorData: ColorData;

    if (isArray(value)) {
      // Handle color array [r, g, b, a]
      const [r, g, b, a] = value as [number, number, number, number];
      colorData = {
        rgb: [r, g, b],
        alpha: a,
        format: ColorFormat.RGB
      };
    } else if (typeof value === 'object' && value !== null && !isNode(value)) {
      // Handle ColorData object
      colorData = value as ColorData;

      // Validate that we have either rgb, hsl, or a node to parse
      if (!colorData.rgb && !colorData.hsl && !colorData.node) {
        throw new TypeError('Color constructor requires rgb, hsl, or node property');
      }
    } else if (typeof value === 'string') {
      // Handle hex string
      colorData = {
        node: value,
        format: ColorFormat.HEX
      };
    } else {
      throw new TypeError('Color constructor requires ColorData object, hex string, or color array');
    }

    super(colorData, options, location, context);
  }

  /**
   * Get RGB values, converting from HSL if needed.
   * Returns clamped values (0-255) for better developer experience.
   * For internal calculations, use _rgb instead.
   */
  get rgb(): [number, number, number] {
    const [r, g, b] = this._rgb;
    return [
      Math.max(0, Math.min(255, Math.round(r))),
      Math.max(0, Math.min(255, Math.round(g))),
      Math.max(0, Math.min(255, Math.round(b)))
    ];
  }

  /**
   * Internal getter for unclamped RGB values.
   * Use this for calculations and conversions.
   */
  get _rgb(): [number, number, number] {
    if (this.value.rgb) {
      return this.value.rgb;
    }

    if (this.value.hsl) {
      // Convert HSL to RGB
      const [h, s, l] = this.value.hsl;
      const hue = h / 360;
      const sat = s;
      const light = l;

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
      this.value.rgb = rgb;
      return rgb;
    }

    // If value has a node that's a string, parse it as hex
    if (this.value.node && typeof this.value.node === 'string') {
      let rgba: number[] = [];
      let hex = this.value.node.slice(1);

      if (hex.length >= 6) {
        (hex.match(/.{2}/g) as RegExpMatchArray).forEach((c, i) => {
          if (i < 3) {
            rgba.push(parseInt(c, 16));
          } else {
            rgba.push(parseInt(c, 16) / 255);
          }
        });
      } else {
        hex.split('').forEach((c, i) => {
          if (i < 3) {
            rgba.push(parseInt(c + c, 16));
          } else {
            rgba.push(parseInt(c + c, 16) / 255);
          }
        });
      }

      const rgb = [rgba[0]!, rgba[1]!, rgba[2]!] as [number, number, number];
      this.value.rgb = rgb;
      if (rgba.length === 3) {
        this.value.alpha = 1;
      } else {
        this.value.alpha = rgba[3]!;
      }
      return rgb;
    }

    throw new TypeError('Cannot convert color value to rgb');
  }

  set rgb(rgb: [number, number, number]) {
    this.value.rgb = rgb;
    // Clear HSL cache since we're setting RGB directly
    this.value.hsl = undefined;
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
      Math.max(0, Math.min(1, s)), // Clamp saturation to 0-1
      Math.max(0, Math.min(1, l))  // Clamp lightness to 0-1
    ];
  }

  /**
   * Internal getter for unclamped HSL values.
   * Use this for calculations and conversions.
   */
  get _hsl(): [number, number, number] {
    if (this.value.hsl) {
      return this.value.hsl;
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
    this.value.hsl = hsl;
    return hsl;
  }

  set hsl(hsl: [number, number, number]) {
    this.value.hsl = hsl;
    // Clear RGB cache since we're setting HSL directly
    this.value.rgb = undefined;
  }

  /**
   * Get alpha value.
   * Returns clamped value (0-1) for better developer experience.
   * For internal calculations, use _alpha instead.
   */
  get alpha(): number {
    return Math.max(0, Math.min(1, this._alpha));
  }

  /**
   * Internal getter for unclamped alpha value.
   * Use this for calculations and conversions.
   */
  get _alpha(): number {
    return this.value.alpha ?? 1;
  }

  set alpha(alpha: number) {
    this.value.alpha = alpha;
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
    this.value.rgb = [r, g, b];
    this.value.alpha = a;
    this.value.hsl = undefined;
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
    this.value.hsl = [h, s, l];
    this.value.alpha = a;
    this.value.rgb = undefined;
  }

  toHSL(): [number, number, number] {
    return this.hsl;
  }

  toHex(): string {
    const values = this.rgb;
    let alpha = this.alpha;
    if (alpha < 1) {
      values.push(Math.round(alpha * 255));
    }
    let hex = '#' + values.map(function(c) {
      let hex = c.toString(16);
      return hex.length === 1 ? '0' + hex : hex;
    }).join('').toUpperCase();
    return hex;
  }

  override toTrimmedString(options?: PrintOptions) {
    options = getPrintOptions(options);
    const w = options.writer!;
    const mark = w.mark();

    // If value has a node that's a Node, serialize it directly
    if (this.value.node && isNode(this.value.node)) {
      return this.value.node.toTrimmedString(options);
    }

    // If value has a node that's a string, output it as-is
    if (this.value.node && typeof this.value.node === 'string') {
      w.add(this.value.node, this);
      return w.getSince(mark);
    }

    // Handle format-based serialization
    const format = this.value.format;
    if (format === ColorFormat.RGB) {
      if (this.alpha < 1) {
        w.add('rgba(', this);
        w.add(this.rgb.join(', ') + ', ' + this.alpha);
        w.add(')');
      } else {
        w.add('rgb(', this);
        w.add(this.rgb.join(', '));
        w.add(')');
      }
      return w.getSince(mark);
    } else if (format === ColorFormat.HSL) {
      if (this.alpha < 1) {
        w.add('hsla(', this);
        const [h, s, l] = this.hsl;
        w.add(`${round(h, 8)}, ${round(s * 100, 8)}%, ${round(l * 100, 8)}%, ${this.alpha}`);
        w.add(')');
      } else {
        w.add('hsl(', this);
        const [h, s, l] = this.hsl;
        w.add(`${round(h, 8)}, ${round(s * 100, 8)}%, ${round(l * 100, 8)}%`);
        w.add(')');
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

    if (isNode(b, 'Dimension')) {
      const { number: bVal, unit: bUnit } = b.value;
      if (bUnit) {
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
    let { format } = this.value;
    let newColor = new Color({
      rgb: newColorValues,
      alpha: newAlpha,
      format: format
    }).inherit(this);

    return newColor;
  }

  /** Create a new Color with a Call node for the original function */
  static fromFunctionCall(format: ColorFormat, args: any[], alpha: number = 1): Color {
    // Create a Call node with the original arguments
    const callNode = new Call({
      name: format === ColorFormat.RGB ? 'rgb' : 'hsl',
      args: new List(args)
    });

    const color = new Color({
      format,
      node: callNode,
      alpha
    });

    return color;
  }
}

export const color = defineType(Color, 'Color');