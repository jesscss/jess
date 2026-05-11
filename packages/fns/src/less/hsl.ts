import { Color, ColorFormat, Dimension, defineFunction, type FunctionThis, Any } from '@jesscss/core';
import { percentOf, toNumber, splitSequence, normalizeHue } from '@jesscss/core';
import { parseRelativeColorSyntax, evaluateOriginColor, evaluateHSLChannelReference } from '../util/relative-color.js';
import { collectRawDimensions } from '../util/raw-color-args.js';
import { formatColorOutput } from '../util/color-output.js';

function hueChannelFromNode(node: unknown, hueValue: number): number | [number, string] {
  if (!(node instanceof Dimension)) {
    return hueValue;
  }
  const { unit } = node.value;
  return unit ? [hueValue, unit] : hueValue;
}

function getRawHueChannel(rawArgs: any, hueValue: number): number | [number, string] {
  const firstRawArg = rawArgs?.value?.[0];
  if (!firstRawArg) {
    return hueValue;
  }
  if (firstRawArg instanceof Dimension) {
    return hueChannelFromNode(firstRawArg, hueValue);
  }
  if (Array.isArray(firstRawArg?.value) && firstRawArg.value[0] instanceof Dimension) {
    return hueChannelFromNode(firstRawArg.value[0], hueValue);
  }
  return hueValue;
}

function alphaChannelFromNode(node: unknown, alphaValue: number): number | [number, string] {
  if (!(node instanceof Dimension)) {
    return alphaValue;
  }
  const { number, unit } = node.value;
  if (unit === '%') {
    const percentValue = Math.max(0, Math.min(100, number));
    return [percentValue, '%'];
  }
  return alphaValue;
}

function getRawAlphaChannel(rawArgs: any, alphaValue: number, hasExplicitAlpha: boolean): number | [number, string] {
  if (!hasExplicitAlpha || !rawArgs?.value?.length) {
    return alphaValue;
  }
  const dimensions: Dimension[] = [];
  collectRawDimensions(rawArgs.value, dimensions);
  const lastDimension = dimensions.at(-1);
  if (lastDimension) {
    return alphaChannelFromNode(lastDimension, alphaValue);
  }
  return alphaValue;
}

function coerceNumericArg(arg: unknown): number {
  const num = Number(arg);
  if (Number.isNaN(num)) {
    throw new Error('Invalid arguments for hsl function');
  }
  return num;
}

const hsl = defineFunction(
  'hsl',
  async function(this: FunctionThis, ...args: any[]) {
    const modernSyntax = Boolean(this?.caller?.options?.modernSyntax);
    // Check for relative color syntax first: hsl(from color h s l)
    if (this?.context && this.rawArgs) {
      const relativeData = parseRelativeColorSyntax(this.rawArgs);
      if (relativeData) {
        // Evaluate the origin color
        const originColor = await evaluateOriginColor(relativeData.originColor, this.context);

        // Extract channel values from origin color
        const originAlpha = originColor._alpha;

        // Evaluate channel references
        if (relativeData.channels.length < 3) {
          throw new Error('Relative hsl() requires at least 3 channel values (h, s, l)');
        }

        // Evaluate each channel reference
        const hChannel = relativeData.channels[0]!;
        const sChannel = relativeData.channels[1]!;
        const lChannel = relativeData.channels[2]!;
        const alphaChannel = relativeData.channels[3];

        // Evaluate H, S, L channels
        // Channel references can reference any channel (h, s, l, alpha)
        // Supports both simple identifiers and calc() expressions
        let h = await evaluateHSLChannelReference(hChannel, originColor, this.context);
        let s = await evaluateHSLChannelReference(sChannel, originColor, this.context);
        let l = await evaluateHSLChannelReference(lChannel, originColor, this.context);

        // Handle alpha channel if present
        // Alpha can be in two places:
        // 1. As the 4th channel in the sequence: hsl(from color h s l alpha)
        // 2. Separated by /: hsl(from color h s l / 0.5) - this is in relativeData.alpha
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

        // Normalize hue to 0-360 range
        h = ((h % 360) + 360) % 360;
        // Clamp saturation and lightness to 0-1
        s = Math.max(0, Math.min(1, s));
        l = Math.max(0, Math.min(1, l));

        // Create the new color
        const hueChannel = hueChannelFromNode(hChannel, h);
        const color = new Color({
          hsl: [hueChannel, s, l],
          alpha: alphaValue
        }, {
          format: ColorFormat.HSL,
          modernSyntax
        });

        return color;
      }
    }

    // Handle overloaded signatures - check Dimension signature first (most common)
    if (args.length >= 3 && !(args[0] instanceof Color)) {
      // [Dimension, Dimension, Dimension, Dimension?] - h, s, l, optional alpha
      let h = coerceNumericArg(args[0]);
      let s = coerceNumericArg(args[1]);
      let l = coerceNumericArg(args[2]);
      let alpha = args[3] !== undefined ? coerceNumericArg(args[3]) : 1;
      h = ((h % 360) + 360) % 360;
      s = Math.max(0, Math.min(1, s));
      l = Math.max(0, Math.min(1, l));
      const alphaChannel = getRawAlphaChannel(this?.rawArgs, alpha, args[3] !== undefined);
      const clampedHslColor = new Color({
        hsl: [getRawHueChannel(this?.rawArgs, h), s, l],
        alpha: alphaChannel
      }, {
        format: ColorFormat.HSL,
        modernSyntax
      });

      if (s === 0 || l === 0 || l === 1) {
        const canonicalColor = new Color({
          rgb: clampedHslColor.rgb,
          alpha: alphaChannel
        }, {
          format: ColorFormat.HSL,
          modernSyntax
        });
        canonicalColor.value.node = undefined;
        return canonicalColor;
      }

      clampedHslColor.value.node = undefined;
      return clampedHslColor;
    } else if (args.length === 1 && args[0] instanceof Color) {
      // [Color] - output the color in HSL format
      const [inputColor] = args;
      return formatColorOutput(inputColor, ColorFormat.HSL, modernSyntax);
    } else if (args.length >= 1 && args.length <= 2 && args[0] instanceof Color) {
      // [Color, Dimension?] - output the color in HSL format and optionally set alpha
      const [inputColor] = args;
      let alphaChannel = inputColor.value.alpha;
      if (args[1] !== undefined) {
        // callWithContext can still surface unitless numeric nodes here, so
        // coerce the overload the same way the numeric branches do.
        const alpha = coerceNumericArg(args[1]);
        const normalizedAlpha = Math.max(0, Math.min(1, alpha));
        alphaChannel = getRawAlphaChannel(this?.rawArgs, normalizedAlpha, args[1] !== undefined);
      }

      return formatColorOutput(inputColor, ColorFormat.HSL, modernSyntax, alphaChannel);
    } else {
      throw new Error('Invalid arguments for hsl function');
    }
  },
  {
    params: [
      // [Dimension, Dimension, Dimension, Dimension?] - h, s, l, optional alpha (most common, try first)
      [{
        name: 'h',
        type: Dimension,
        convert: [normalizeHue(), toNumber()]
      }, {
        name: 's',
        type: Dimension,
        convert: [percentOf(1), toNumber()]
      }, {
        name: 'l',
        type: Dimension,
        convert: [percentOf(1), toNumber()]
      }, {
        name: 'a',
        type: Dimension,
        optional: true,
        convert: [percentOf(1), toNumber()]
      }],
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

export default hsl;
