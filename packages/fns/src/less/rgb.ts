import {
  type FunctionThis,
  Dimension,
  Color,
  ColorFormat,
  defineFunction,
  Any
} from '@jesscss/core';
import { percentOf, toNumber, splitSequence } from '@jesscss/core';
import { parseRelativeColorSyntax, evaluateOriginColor, evaluateRGBChannelReference } from '../util/relative-color.js';

function alphaChannelFromNode(node: unknown, alphaValue: number): number | [number, string] {
  if (!(node instanceof Dimension)) {
    return alphaValue;
  }
  const unit = node.data.unit ?? '';
  if (unit === '%') {
    const percentValue = Math.max(0, Math.min(100, node.data.number));
    return [percentValue, '%'];
  }
  return alphaValue;
}

function collectDimensions(node: unknown, out: Dimension[]): void {
  if (!node) {
    return;
  }
  if (node instanceof Dimension) {
    out.push(node);
    return;
  }
  if (Array.isArray(node)) {
    node.forEach(child => collectDimensions(child, out));
    return;
  }
  if (typeof node === 'object' && node !== null && 'data' in node) {
    const value = (node as { data?: unknown }).data;
    if (Array.isArray(value)) {
      value.forEach(child => collectDimensions(child, out));
    }
  }
}

function getRawAlphaChannel(rawArgs: any, alphaValue: number, hasExplicitAlpha: boolean): number | [number, string] {
  if (!hasExplicitAlpha || !rawArgs?.data?.length) {
    return alphaValue;
  }
  const dimensions: Dimension[] = [];
  collectDimensions(rawArgs.data, dimensions);
  const lastDimension = dimensions.at(-1);
  if (lastDimension) {
    return alphaChannelFromNode(lastDimension, alphaValue);
  }
  return alphaValue;
}

function rgbChannelFromNode(node: unknown, channelValue: number): number | [number, string] {
  if (!(node instanceof Dimension)) {
    return channelValue;
  }
  const unit = node.data.unit ?? '';
  if (unit === '%') {
    return [node.data.number, '%'];
  }
  return channelValue;
}

function getRawRgbChannels(
  rawArgs: any,
  r: number,
  g: number,
  b: number
): [number | [number, string], number | [number, string], number | [number, string]] {
  if (!rawArgs?.data?.length) {
    return [r, g, b];
  }
  const dimensions: Dimension[] = [];
  collectDimensions(rawArgs.data, dimensions);
  const [rDim, gDim, bDim] = dimensions;
  return [
    rgbChannelFromNode(rDim, r),
    rgbChannelFromNode(gDim, g),
    rgbChannelFromNode(bDim, b)
  ];
}

const rgb = defineFunction(
  'rgb',
  async function(this: FunctionThis, ...args: any[]) {
    const modernSyntax = Boolean(this?.caller?.options?.modernSyntax);
    // Check for relative color syntax first: rgb(from color r g b)
    if (this?.context && this.rawArgs) {
      const relativeData = parseRelativeColorSyntax(this.rawArgs);
      if (relativeData) {
        // Evaluate the origin color
        const originColor = await evaluateOriginColor(relativeData.originColor, this.context);

        // Extract channel values from origin color
        const [originR, originG, originB] = originColor._rgb;
        const originAlpha = originColor._alpha;

        // Evaluate channel references
        // For now, we only support simple identifiers (r, g, b, alpha)
        // Expressions like calc(r + 40) will need more complex handling
        if (relativeData.channels.length < 3) {
          throw new Error('Relative rgb() requires at least 3 channel values (r, g, b)');
        }

        // Evaluate each channel reference
        const rChannel = relativeData.channels[0]!;
        const gChannel = relativeData.channels[1]!;
        const bChannel = relativeData.channels[2]!;
        const alphaChannel = relativeData.channels[3];

        // Evaluate R, G, B channels
        // Channel references can reference any channel (r, g, b, alpha)
        // The helper function handles conversion (e.g., alpha 0-1 -> 0-255 for RGB channels)
        // Supports both simple identifiers and calc() expressions
        let r = await evaluateRGBChannelReference(rChannel, originColor, this.context);
        let g = await evaluateRGBChannelReference(gChannel, originColor, this.context);
        let b = await evaluateRGBChannelReference(bChannel, originColor, this.context);

        // Handle alpha channel if present
        // Alpha can be in two places:
        // 1. As the 4th channel in the sequence: rgb(from color r g b alpha)
        // 2. Separated by /: rgb(from color r g b / 0.5) - this is in relativeData.alpha
        let alpha: number = originAlpha;
        let alphaValue: number | [number, string] = originAlpha;

        // First check if alpha is separated by / (from parseRelativeColorSyntax)
        if (relativeData.alpha) {
          // Try to evaluate as a Dimension (for explicit alpha values like 0.5 or 50%)
          const evaluated = await relativeData.alpha.eval(this.context);
          if (evaluated instanceof Dimension) {
            const alphaNumber = evaluated.data.number;
            const alphaUnit = evaluated.data.unit;
            if (alphaUnit === '%') {
              alpha = alphaNumber / 100;
            } else if (alphaUnit === '' || alphaUnit === undefined) {
              alpha = alphaNumber;
            } else {
              throw new Error(`Invalid alpha value unit: ${alphaUnit}`);
            }
            alpha = Math.max(0, Math.min(1, alpha));
            alphaValue = alphaChannelFromNode(evaluated, alpha);
          } else {
            throw new Error('Alpha value separated by / must evaluate to a Dimension');
          }
        } else if (alphaChannel) {
          // Check if it's a channel reference (alpha) or an explicit value
          if (alphaChannel instanceof Any && typeof alphaChannel.data === 'string') {
            const channelName = alphaChannel.data.toLowerCase();
            if (channelName === 'alpha') {
              alpha = originAlpha;
            } else {
              throw new Error(`Invalid alpha channel reference: ${channelName}. Must be alpha`);
            }
          } else {
            // Try to evaluate as a Dimension (for explicit alpha values like 0.5 or 50%)
            const evaluated = await alphaChannel.eval(this.context);
            if (evaluated instanceof Dimension) {
              const alphaNumber = evaluated.data.number;
              const alphaUnit = evaluated.data.unit;
              if (alphaUnit === '%') {
                alpha = alphaNumber / 100;
              } else if (alphaUnit === '' || alphaUnit === undefined) {
                alpha = alphaNumber;
              } else {
                throw new Error(`Invalid alpha value unit: ${alphaUnit}`);
              }
              alpha = Math.max(0, Math.min(1, alpha));
              alphaValue = alphaChannelFromNode(evaluated, alpha);
            } else {
              throw new Error('Channel expressions (like calc()) are not yet supported in relative color syntax');
            }
          }
        }
        const hasExplicitAlpha = Boolean(relativeData.alpha || alphaChannel);
        alphaValue = getRawAlphaChannel(this?.rawArgs, alpha, hasExplicitAlpha);

        // Clamp RGB values to 0-255
        r = Math.max(0, Math.min(255, r));
        g = Math.max(0, Math.min(255, g));
        b = Math.max(0, Math.min(255, b));

        // Create the new color
        const color = new Color({
          rgb: [r, g, b],
          alpha: alphaValue
        }, {
          format: ColorFormat.RGB,
          modernSyntax
        });

        return color;
      }
    }

    // Handle overloaded signatures - check Dimension signature first (most common)
    if (args.length >= 3 && !(args[0] instanceof Color)) {
      // [Dimension, Dimension, Dimension, Dimension?] - r, g, b, optional alpha
      let r: number = args[0] as number;
      let g: number = args[1] as number;
      let b: number = args[2] as number;
      let alpha: number = args[3] !== undefined ? (args[3] as number) : 1;
      const [rawR, rawG, rawB] = getRawRgbChannels(this?.rawArgs, r, g, b);
      const alphaChannel = getRawAlphaChannel(this?.rawArgs, alpha, args[3] !== undefined);

      // Create a color with RGB format and store the original function call
      const color = new Color({
        rgb: [rawR, rawG, rawB],
        alpha: alphaChannel
      }, {
        format: ColorFormat.RGB,
        modernSyntax
      });

      return color;
    } else if (args.length === 1 && args[0] instanceof Color) {
      // [Color] - clone the color and set format to RGB
      const inputColor = args[0] as Color;
      const cloned = inputColor.clone();
      cloned.options.format = ColorFormat.RGB;
      cloned.options.modernSyntax = modernSyntax;
      cloned.setData('node', undefined);
      return cloned;
    } else if (args.length >= 1 && args.length <= 2 && args[0] instanceof Color) {
      // [Color, Dimension?] - clone color, set format to RGB, and optionally set alpha
      const inputColor = args[0] as Color;
      const cloned = inputColor.clone();
      cloned.options.format = ColorFormat.RGB;
      cloned.options.modernSyntax = modernSyntax;
      cloned.setData('node', undefined);

      if (args[1] !== undefined) {
        // args[1] is already converted by percentOf(1), toNumber() conversion plugins
        const alpha = args[1] as number;
        const normalizedAlpha = Math.max(0, Math.min(1, alpha));
        cloned.setData('alpha', getRawAlphaChannel(this?.rawArgs, normalizedAlpha, args[1] !== undefined));
      }

      return cloned;
    } else {
      throw new Error('Invalid arguments for rgb function');
    }
  },
  {
    params: [
      // [Dimension, Dimension, Dimension, Dimension?] - r, g, b, optional alpha (most common, try first)
      [
        {
          name: 'r',
          type: Dimension,
          convert: [percentOf(255), toNumber()]
        },
        {
          name: 'g',
          type: Dimension,
          convert: [percentOf(255), toNumber()]
        },
        {
          name: 'b',
          type: Dimension,
          convert: [percentOf(255), toNumber()]
        },
        {
          name: 'a',
          type: Dimension,
          optional: true,
          convert: [percentOf(1), toNumber()]
        }
      ],
      // [Color] - single color argument
      [{ name: 'color', type: Color }],
      // [Color, Dimension?] - color with optional opacity
      [
        { name: 'color', type: Color },
        {
          name: 'opacity',
          type: Dimension,
          optional: true,
          convert: [percentOf(1), toNumber()]
        }
      ]
    ],
    preprocessParams: [splitSequence()]
  }
);

export default rgb;