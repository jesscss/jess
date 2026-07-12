import {
  type FunctionThis,
  Dimension,
  Color,
  ColorFormat,
  defineFunction,
  Any,
  type DefineFunctionOptions
} from '@jesscss/core';
import { percentOf, toNumber, splitSequence } from '@jesscss/core';
import { parseRelativeColorSyntax, evaluateOriginColor, evaluateRGBChannelReference } from '../util/relative-color.js';
import { collectRawDimensions } from '../util/raw-color-args.js';
import { formatColorOutput } from '../util/color-output.js';

function alphaChannelFromNode(node: unknown, alphaValue: number): number | [number, string] {
  if (!(node instanceof Dimension)) {
    return alphaValue;
  }
  const { number, unit } = node;
  if (unit === '%') {
    const percentValue = Math.max(0, Math.min(100, number));
    return [percentValue, '%'];
  }
  return alphaValue;
}

function getRawAlphaChannel(rawArgs: any, alphaValue: number, hasExplicitAlpha: boolean): number | [number, string] {
  if (!hasExplicitAlpha || !rawArgs?.items?.length) {
    return alphaValue;
  }
  const dimensions: Dimension[] = [];
  collectRawDimensions(rawArgs.items, dimensions);
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
  const { number, unit } = node;
  if (unit === '%') {
    return [number, '%'];
  }
  return channelValue;
}

function getRawRgbChannels(
  rawArgs: any,
  r: number,
  g: number,
  b: number
): [number | [number, string], number | [number, string], number | [number, string]] {
  if (!rawArgs?.items?.length) {
    return [r, g, b];
  }
  const dimensions: Dimension[] = [];
  collectRawDimensions(rawArgs.items, dimensions);
  const [rDim, gDim, bDim] = dimensions;
  return [
    rgbChannelFromNode(rDim, r),
    rgbChannelFromNode(gDim, g),
    rgbChannelFromNode(bDim, b)
  ];
}

function coerceRgbNumber(arg: unknown): number {
  const number = Number(arg);
  if (Number.isNaN(number)) {
    throw new Error('Invalid arguments for rgb function');
  }
  return number;
}

export async function rgbImplementation(this: FunctionThis | undefined, ...args: any[]): Promise<Color> {
    const modernSyntax = Boolean(this?.caller?.options?.modernSyntax);
    // Check for relative color syntax first: rgb(from color r g b)
    if (this?.context && this.rawArgs) {
      const relativeData = parseRelativeColorSyntax(this.rawArgs);
      if (relativeData) {
        // Evaluate the origin color
        const originColor = await evaluateOriginColor(relativeData.originColor, this.context);

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
            const { number: alphaNumber, unit: alphaUnit } = evaluated.value;
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
          if (alphaChannel instanceof Any && typeof alphaChannel.value === 'string') {
            const channelName = alphaChannel.value.toLowerCase();
            if (channelName === 'alpha') {
              alpha = originAlpha;
            } else {
              throw new Error(`Invalid alpha channel reference: ${channelName}. Must be alpha`);
            }
          } else {
            // Try to evaluate as a Dimension (for explicit alpha values like 0.5 or 50%)
            const evaluated = await alphaChannel.eval(this.context);
            if (evaluated instanceof Dimension) {
              const { number: alphaNumber, unit: alphaUnit } = evaluated.value;
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
      let r = coerceRgbNumber(args[0]);
      let g = coerceRgbNumber(args[1]);
      let b = coerceRgbNumber(args[2]);
      let alpha = args[3] !== undefined ? coerceRgbNumber(args[3]) : 1;
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
      // [Color] - output the color in RGB format
      const inputColor = args[0];
      return formatColorOutput(inputColor, ColorFormat.RGB, modernSyntax);
    } else if (args.length >= 1 && args.length <= 2 && args[0] instanceof Color) {
      // [Color, Dimension?] - output the color in RGB format and optionally set alpha
      const inputColor = args[0];
      let alphaChannel = inputColor._alphaValue;
      if (args[1] !== undefined) {
        // args[1] is already converted by percentOf(1), toNumber() conversion plugins
        const alpha = coerceRgbNumber(args[1]);
        const normalizedAlpha = Math.max(0, Math.min(1, alpha));
        alphaChannel = getRawAlphaChannel(this?.rawArgs, normalizedAlpha, args[1] !== undefined);
      }

      return formatColorOutput(inputColor, ColorFormat.RGB, modernSyntax, alphaChannel);
    } else {
      throw new Error('Invalid arguments for rgb function');
    }
}

export const rgbOptions = {
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
} satisfies DefineFunctionOptions;

const rgb = defineFunction(
  'rgb',
  rgbImplementation,
  rgbOptions
);

export default rgb;
