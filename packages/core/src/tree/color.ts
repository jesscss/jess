import { Node, defineType } from './node';
import { calculate, type Operator } from './util/calculate';
import { type Context } from '../context';
import { isNode } from './util/is-node';
import round from 'lodash-es/round';
import { type PrintOptions, getPrintOptions } from './util/print.js';

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
  rgba?: [number, number, number, number];
}

export interface Color extends Node<ColorData> {
  eval(context: Context): Color;
}

/**
 * Color's `value` will always be a ColorData object containing
 * the node representation, format, and rgba values.
 */
export class Color extends Node<ColorData> {
  type = 'Color' as const;
  shortType = 'color' as const;
  // Color values are static and don't need evaluation

  private _hsl: [number, number, number] | undefined;

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
        rgba: [r, g, b, a],
        format: ColorFormat.RGB
      };
    } else if (typeof value === 'object' && value !== null && !isNode(value)) {
      // Handle ColorData object
      colorData = value as ColorData;
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

  /** Create an rgba map only if we need it */
  get rgba(): ColorValues {
    // If value has rgba, use it
    if (this.value.rgba) {
      return this.value.rgba;
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
      /** Make sure an alpha value is present */
      if (rgba.length === 3) {
        rgba.push(1);
      }
      return rgba as ColorValues;
    }

    throw new TypeError('Cannot convert color value to rgba');
  }

  set rgba(rgba: ColorValues) {
    this.value.rgba = rgba as [number, number, number, number];
    this._hsl = undefined;
  }

  get rgb(): [number, number, number] {
    const [r, g, b] = this.rgba;
    return [r, g, b];
  }

  set rgb(rgb: [number, number, number]) {
    const [r, g, b] = rgb;
    const a = this.alpha;
    this.rgba = [r, g, b, a];
  }

  get alpha(): number {
    // If value has rgba, use it directly
    if (this.value.rgba) {
      return this.value.rgba[3];
    }
    // Otherwise, try to get it through the rgba getter
    return this.rgba[3];
  }

  set alpha(alpha: number) {
    const [r, g, b] = this.rgb;
    this.rgba = [r, g, b, alpha];
  }

  set hsla(hsla: [number, number, number, number]) {
    const [h, s, l, a] = hsla;

    // Convert HSL to RGB
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

    // Set rgba directly to avoid circular dependency
    this.value.rgba = [r * 255, g * 255, b * 255, a];
    this._hsl = [h, s, l];
  }

  get hsla(): [number, number, number, number] {
    if (!this._hsl) {
      let [r, g, b] = this.rgb;
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
          case r: h = (g - b) / d + (g < b ? 6 : 0);
            break;
          case g: h = (b - r) / d + 2;
            break;
          case b: h = (r - g) / d + 4;
            break;
        }
        h! /= 6;
      }
      this._hsl = [h! * 360, s, l];
    }
    return [...this._hsl, this.alpha];
  }

  toHSL(): [number, number, number] {
    let [h, s, l] = this.hsla;
    return [h, s, l];
  }

  toHex(): string {
    let [r, g, b] = this.rgb;
    // Clamp RGB values to 0-255 for hex conversion
    const clampedRgb = [r, g, b].map(c => Math.max(0, Math.min(255, Math.round(c))));
    let hex = '#' + clampedRgb.map(function(c) {
      let hex = c.toString(16);
      return hex.length === 1 ? '0' + hex : hex;
    }).join('');
    return hex;
  }

  override toTrimmedString(options?: PrintOptions) {
    options = getPrintOptions(options);
    const w = options.writer!;
    const mark = w.mark();

    console.log('🔍 Color.toTrimmedString - value:', this.value, 'type:', typeof this.value);

    // If value has a node that's a Node, serialize it directly
    if (this.value.node && isNode(this.value.node)) {
      w.add(this.value.node.toTrimmedString(options), this);
      return w.getSince(mark);
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
        // Clamp RGB values to 0-255 and alpha to 0-1
        const clampedRgb = this.rgb.map(c => Math.max(0, Math.min(255, Math.round(c))));
        const clampedAlpha = Math.max(0, Math.min(1, this.alpha));
        w.add(clampedRgb.join(', ') + ', ' + clampedAlpha);
        w.add(')');
      } else {
        w.add('rgb(', this);
        // Clamp RGB values to 0-255
        const clampedRgb = this.rgb.map(c => Math.max(0, Math.min(255, Math.round(c))));
        w.add(clampedRgb.join(', '));
        w.add(')');
      }
      return w.getSince(mark);
    } else if (format === ColorFormat.HSL) {
      if (this.alpha < 1) {
        w.add('hsla(', this);
        let [h, s, l] = this.hsla;
        // Clamp HSL values appropriately
        const clampedH = ((h % 360) + 360) % 360; // Wrap hue to 0-360
        const clampedS = Math.max(0, Math.min(1, s)); // Clamp saturation to 0-1
        const clampedL = Math.max(0, Math.min(1, l)); // Clamp lightness to 0-1
        const clampedAlpha = Math.max(0, Math.min(1, this.alpha)); // Clamp alpha to 0-1
        w.add(`${round(clampedH, 8)}, ${round(clampedS * 100, 8)}%, ${round(clampedL * 100, 8)}%, ${clampedAlpha}`);
        w.add(')');
      } else {
        w.add('hsl(', this);
        let [h, s, l] = this.hsla;
        // Clamp HSL values appropriately
        const clampedH = ((h % 360) + 360) % 360; // Wrap hue to 0-360
        const clampedS = Math.max(0, Math.min(1, s)); // Clamp saturation to 0-1
        const clampedL = Math.max(0, Math.min(1, l)); // Clamp lightness to 0-1
        w.add(`${round(clampedH, 8)}, ${round(clampedS * 100, 8)}%, ${round(clampedL * 100, 8)}%`);
        w.add(')');
      }
      return w.getSince(mark);
    }

    // Default to hex
    w.add(this.toHex(), this);
    return w.getSince(mark);
  }

  override operate(b: Node, op: Operator, context?: Context | undefined): Color {
    let bNode = b;
    if (isNode(b, 'Dimension')) {
      const { number: bVal, unit: bUnit } = b.value;
      if (bUnit) {
        throw new TypeError(`Cannot convert "${b}" to a color`);
      }
      bNode = new Color({ format: ColorFormat.RGB, rgba: [bVal, bVal, bVal, 1] }).inherit(b);
    }
    if (!(bNode instanceof Color)) {
      throw new TypeError(`Cannot operate on ${bNode.type}`);
    }
    let aRGB = this.rgb;
    let bRGB = bNode.rgb;
    let newColorValues = aRGB.map((a, i) => calculate(a, op, bRGB[i]!));

    // Create new color with preserved data
    let { format } = this.value;
    let newColor = new Color({
      rgba: [...newColorValues, this.alpha * (1 - bNode.alpha) + bNode.alpha] as [number, number, number, number],
      format: format
    }).inherit(this);

    return newColor;
  }

  /** @todo move to visitors */
  // toCSS(context: Context, out: OutputCollector) {
  //   out.add(this.toString(), this.location)
  // }

  // toModule(context: Context, out: OutputCollector) {
  //   out.add(`$J.color("${this.value}")`)
  // }
}

export const color = defineType(Color, 'Color');