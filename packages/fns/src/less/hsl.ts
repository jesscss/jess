import { Color, ColorFormat, Dimension, defineFunction, type FunctionThis, Call, TreeContext } from '@jesscss/core';
import { normalizeHue, percentOf, toNumber, splitSequence } from '@jesscss/core';

const hsl = defineFunction(
  'hsl',
  async function(this: FunctionThis, ...args: any[]) {
    // Handle overloaded signatures - check Dimension signature first (most common)
    if (args.length >= 3 && !(args[0] instanceof Color)) {
      // [Dimension, Dimension, Dimension, Dimension?] - h, s, l, optional alpha
      let h: number = args[0] as number;
      let s: number = args[1] as number;
      let l: number = args[2] as number;
      let alpha: number = args[3] !== undefined ? (args[3] as number) : 1;

      // Create a color with HSL format and store the original function call
      const color = new Color({
        format: ColorFormat.HSL,
        hsl: [h, s, l],
        alpha
      });

      // Store the original function call
      if (this?.context) {
        let context = this.context;
        let treeContext = context.treeContext;
        /** Make sure we preserve a slash in the argument */
        context.treeContext = new TreeContext({
          mathMode: 'parens-division'
        });

        color.value.node = new Call({
          name: 'hsl',
          args: await this.rawArgs.eval(context)
        });
        context.treeContext = treeContext;
      }

      return color;
    } else if (args.length === 1 && args[0] instanceof Color) {
      // [Color] - clone the color and set format to HSL
      const inputColor = args[0] as Color;
      const cloned = inputColor.clone();
      cloned.value.format = ColorFormat.HSL;
      cloned.value.node = undefined;
      return cloned;
    } else if (args.length >= 1 && args.length <= 2 && args[0] instanceof Color) {
      // [Color, Dimension?] - clone color, set format to HSL, and optionally set alpha
      const inputColor = args[0] as Color;
      const cloned = inputColor.clone();
      cloned.value.format = ColorFormat.HSL;
      cloned.value.node = undefined;

      if (args[1] !== undefined) {
        // args[1] is already converted by percentOf(1), toNumber() conversion plugins
        const alpha = args[1] as number;
        cloned.value.alpha = Math.max(0, Math.min(1, alpha));
      }

      return cloned;
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