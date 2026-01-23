import {
  type FunctionThis,
  Dimension,
  Color,
  ColorFormat,
  defineFunction,
  Call,
  TreeContext,
  Any
} from '@jesscss/core';
import { percentOf, toNumber, splitSequence } from '@jesscss/core';
import { parseRelativeColorSyntax, evaluateOriginColor, evaluateRGBChannelReference } from '../util/relative-color.js';

const rgb = defineFunction(
  'rgb',
  async function(this: FunctionThis, ...args: any[]) {
    // Check for relative color syntax first: rgb(from color r g b)
    if (this?.context && this.rawArgs) {
      const relativeData = parseRelativeColorSyntax(this.rawArgs);
      if (relativeData) {
        // Evaluate the origin color
        const originColor = await evaluateOriginColor(relativeData.originColor, this.context);
        
        // Extract channel values from origin color
        const [originR, originG, originB] = originColor._rgb;
        const originAlpha = originColor.value.alpha ?? 1;
        
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
        
        // First check if alpha is separated by / (from parseRelativeColorSyntax)
        if (relativeData.alpha) {
          // Try to evaluate as a Dimension (for explicit alpha values like 0.5 or 50%)
          const evaluated = await relativeData.alpha.eval(this.context);
          if (evaluated instanceof Dimension) {
            const alphaValue = evaluated.value.number;
            const alphaUnit = evaluated.value.unit;
            if (alphaUnit === '%') {
              alpha = alphaValue / 100;
            } else if (alphaUnit === '' || alphaUnit === undefined) {
              alpha = alphaValue;
            } else {
              throw new Error(`Invalid alpha value unit: ${alphaUnit}`);
            }
            alpha = Math.max(0, Math.min(1, alpha));
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
              const alphaValue = evaluated.value.number;
              const alphaUnit = evaluated.value.unit;
              if (alphaUnit === '%') {
                alpha = alphaValue / 100;
              } else if (alphaUnit === '' || alphaUnit === undefined) {
                alpha = alphaValue;
              } else {
                throw new Error(`Invalid alpha value unit: ${alphaUnit}`);
              }
              alpha = Math.max(0, Math.min(1, alpha));
            } else {
              throw new Error('Channel expressions (like calc()) are not yet supported in relative color syntax');
            }
          }
        }
        
        // Clamp RGB values to 0-255
        r = Math.max(0, Math.min(255, r));
        g = Math.max(0, Math.min(255, g));
        b = Math.max(0, Math.min(255, b));
        
        // Create the new color
        const color = new Color({
          format: ColorFormat.RGB,
          rgb: [r, g, b],
          alpha
        });
        
        // Store the original function call
        let treeContext = this.context.treeContext;
        this.context.treeContext = new TreeContext({
          mathMode: 'parens-division'
        });
        
        color.value.node = new Call({
          name: 'rgb',
          args: await this.rawArgs.eval(this.context)
        });
        this.context.treeContext = treeContext;
        
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

      // Create a color with RGB format and store the original function call
      const color = new Color({
        format: ColorFormat.RGB,
        rgb: [r, g, b],
        alpha
      });

      // Store the original function call
      if (this?.context) {
        let context = this.context;
        let treeContext = context.treeContext;
        context.treeContext = new TreeContext({
          mathMode: 'parens-division'
        });

        color.value.node = new Call({
          name: 'rgb',
          args: await this.rawArgs.eval(context)
        });
        context.treeContext = treeContext;
      }

      return color;
    } else if (args.length === 1 && args[0] instanceof Color) {
      // [Color] - clone the color and set format to RGB
      const inputColor = args[0] as Color;
      const cloned = inputColor.clone();
      cloned.value.format = ColorFormat.RGB;
      cloned.value.node = undefined;
      return cloned;
    } else if (args.length >= 1 && args.length <= 2 && args[0] instanceof Color) {
      // [Color, Dimension?] - clone color, set format to RGB, and optionally set alpha
      const inputColor = args[0] as Color;
      const cloned = inputColor.clone();
      cloned.value.format = ColorFormat.RGB;
      cloned.value.node = undefined;

      if (args[1] !== undefined) {
        // args[1] is already converted by percentOf(1), toNumber() conversion plugins
        const alpha = args[1] as number;
        cloned.value.alpha = Math.max(0, Math.min(1, alpha));
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