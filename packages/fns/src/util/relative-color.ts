import {
  type Node,
  List,
  Sequence,
  Any,
  Color,
  type Context,
  Call,
  Dimension,
  Operation,
  type LocationInfo
} from '@jesscss/core';

type RGBChannelValues = { r: number; g: number; b: number; alpha: number };
type HSLChannelValues = { h: number; s: number; l: number; alpha: number };

function nodeLocation(node: Node): LocationInfo | undefined {
  return node.location.length === 6 ? node.location : undefined;
}

function unwrapCalcChannelExpression(node: Node): Node {
  if (!(node instanceof Call)) {
    return node;
  }
  const { name } = node.value;
  const isCalc = (
    (typeof name === 'string' && name.toLowerCase() === 'calc')
    || (name instanceof Any && typeof name.value === 'string' && name.value.toLowerCase() === 'calc')
  );
  if (!isCalc) {
    return node;
  }
  const { args } = node.value;
  const items = args?.value;
  return items?.[0] ?? node;
}

/**
 * Detects and parses relative color syntax from rawArgs
 * Returns null if not relative color syntax, otherwise returns parsed data
 *
 * Example: rgb(from color r g b) -> { originColor: <color node>, channels: [r, g, b] }
 * Example: rgb(from color r g b / 0.5) -> { originColor: <color node>, channels: [r, g, b], alpha: <alpha node> }
 */
export function parseRelativeColorSyntax(rawArgs: List): {
  originColor: Node;
  channels: Node[];
  alpha?: Node;
} | null {
  if (!rawArgs || !rawArgs.value || rawArgs.value.length === 0) {
    return null;
  }

  const firstArg = rawArgs.value[0];

  // Check if first argument is a Sequence starting with "from"
  if (firstArg instanceof Sequence && firstArg.value && firstArg.value.length > 0) {
    const seqValues = firstArg.value;
    const firstItem = seqValues[0];

    // Check if first item is "from" keyword
    if (firstItem instanceof Any && firstItem.value.toLowerCase() === 'from') {
      // This is relative color syntax
      if (seqValues.length < 2) {
        throw new Error('Relative color syntax requires an origin color after "from"');
      }

      const originColor = seqValues[1]!;
      const channels = seqValues.slice(2) || [];

      // Check if there's an alpha value separated by / (rawArgs.value[1] when sep is '/')
      let alpha: Node | undefined;
      if (rawArgs.value.length > 1 && rawArgs.options?.sep === '/') {
        alpha = rawArgs.value[1];
      }

      return {
        originColor,
        channels,
        alpha
      };
    }
  }

  return null;
}

/**
 * Gets the normalized channel values from an origin color for RGB context
 * Returns values in the ranges specified by CSS Color Module Level 5:
 * - r, g, b: 0-255 (as numbers)
 * - alpha: 0-1 (as number)
 */
export function getRGBChannelValues(originColor: Color): {
  r: number;
  g: number;
  b: number;
  alpha: number;
} {
  const [r, g, b] = originColor._rgb;
  const alpha = originColor._alpha;
  return { r, g, b, alpha };
}

/**
 * Substitutes channel variable references (r, g, b, alpha) in a node tree with Dimension nodes
 * This is used to replace channel variables in calc() expressions with their actual values
 */
function substituteChannelVariables(
  node: Node,
  channelValues: RGBChannelValues | HSLChannelValues,
  format: 'rgb' | 'hsl'
): Node {
  // If it's an Any node representing a channel variable, replace it with a Dimension
  if (node instanceof Any && typeof node.value === 'string') {
    const channelName = node.value.toLowerCase();
    const location = nodeLocation(node);

    if (format === 'rgb' && 'r' in channelValues) {
      switch (channelName) {
        case 'r':
          return new Dimension({ number: channelValues.r, unit: '' }, node.options, location).inherit(node);
        case 'g':
          return new Dimension({ number: channelValues.g, unit: '' }, node.options, location).inherit(node);
        case 'b':
          return new Dimension({ number: channelValues.b, unit: '' }, node.options, location).inherit(node);
        case 'alpha':
          // For RGB context, alpha is 0-1, but when used in calc for r/g/b, it should be 0-255
          // However, according to spec, channel values are resolved first, so alpha stays 0-1
          // The conversion happens when the result is used for r/g/b output
          return new Dimension({ number: channelValues.alpha, unit: '' }, node.options, location).inherit(node);
      }
    } else if (format === 'hsl' && 'h' in channelValues) {
      switch (channelName) {
        case 'h':
          return new Dimension({ number: channelValues.h, unit: 'deg' }, node.options, location).inherit(node);
        case 's':
          return new Dimension({ number: channelValues.s * 100, unit: '%' }, node.options, location).inherit(node);
        case 'l':
          return new Dimension({ number: channelValues.l * 100, unit: '%' }, node.options, location).inherit(node);
        case 'alpha':
          return new Dimension({ number: channelValues.alpha, unit: '' }, node.options, location).inherit(node);
      }
    }
  }

  // If it's a Call node (like calc()), substitute channel variables and evaluate
  if (node instanceof Call) {
    const { args } = node.value;
    const substitutedArgs = args
      ? new List(
          args.value.map((arg: Node) =>
            substituteChannelVariables(arg, channelValues, format)
          ),
          args.options,
          nodeLocation(args)
        ).inherit(args)
      : undefined;
    return new Call({
      ...node.value,
      args: substitutedArgs
    }, node.options, nodeLocation(node)).inherit(node);
  }

  // If it's an Operation, recursively substitute in its operands
  if (node instanceof Operation) {
    const [left, op, right] = node.value;
    return new Operation([
      substituteChannelVariables(left, channelValues, format),
      op,
      substituteChannelVariables(right, channelValues, format)
    ], node.options, nodeLocation(node)).inherit(node);
  }

  // If it's a Sequence or List, recursively substitute in its values
  if (node instanceof Sequence) {
    return new Sequence(
      node.value.map((item: Node) =>
        substituteChannelVariables(item, channelValues, format)
      ),
      node.options,
      nodeLocation(node)
    ).inherit(node);
  }

  if (node instanceof List) {
    return new List(
      node.value.map((item: Node) =>
        substituteChannelVariables(item, channelValues, format)
      ),
      node.options,
      nodeLocation(node)
    ).inherit(node);
  }

  // For other node types, return as-is
  return node;
}

/**
 * Evaluates an RGB channel reference (r, g, b, alpha) from the origin color
 * Returns the numeric value for that channel in RGB range (0-255)
 * Supports both simple identifiers and calc() expressions
 */
export async function evaluateRGBChannelReference(
  channel: Node,
  originColor: Color,
  context: Context
): Promise<number> {
  const channelValues = getRGBChannelValues(originColor);

  // Check if channel is a simple identifier (r, g, b, alpha)
  if (channel instanceof Any && typeof channel.value === 'string') {
    const channelName = channel.value.toLowerCase();

    switch (channelName) {
      case 'r':
        return channelValues.r;
      case 'g':
        return channelValues.g;
      case 'b':
        return channelValues.b;
      case 'alpha':
        // Convert alpha (0-1) to RGB range (0-255) when used for r/g/b
        return channelValues.alpha * 255;
      default:
        throw new Error(`Invalid RGB channel reference: ${channelName}. Must be r, g, b, or alpha`);
    }
  }

  // If it's a Call node (like calc()), substitute channel variables and evaluate
  if (channel instanceof Call) {
    const substituted = substituteChannelVariables(channel, channelValues, 'rgb');
    const evaluated = await unwrapCalcChannelExpression(substituted).eval(context);

    // The result should be a Dimension
    if (evaluated instanceof Dimension) {
      const { number: value } = evaluated.value;
      // Clamp to 0-255 range for RGB
      return Math.max(0, Math.min(255, value));
    }

    throw new Error(`Channel expression must evaluate to a Dimension, got ${evaluated.type}`);
  }

  // For other node types, try to evaluate and extract numeric value
  const evaluated = await channel.eval(context);
  if (evaluated instanceof Dimension) {
    return Math.max(0, Math.min(255, evaluated.value.number));
  }

  throw new Error(`Channel reference must be an identifier or evaluate to a Dimension, got ${channel.type}`);
}

/**
 * Gets the normalized channel values from an origin color for HSL context
 * Returns values in the ranges specified by CSS Color Module Level 5:
 * - h: 0-360 (as number in degrees)
 * - s, l: 0-1 (as numbers, will be converted to percentages in substitution)
 * - alpha: 0-1 (as number)
 */
export function getHSLChannelValues(originColor: Color): {
  h: number;
  s: number;
  l: number;
  alpha: number;
} {
  const [h, s, l] = originColor._hsl;
  const alpha = originColor._alpha;
  return { h, s, l, alpha };
}

/**
 * Evaluates an HSL channel reference (h, s, l, alpha) from the origin color
 * Returns the numeric value for that channel
 * Supports both simple identifiers and calc() expressions
 */
export async function evaluateHSLChannelReference(
  channel: Node,
  originColor: Color,
  context: Context
): Promise<number> {
  const channelValues = getHSLChannelValues(originColor);

  // Check if channel is a simple identifier (h, s, l, alpha)
  if (channel instanceof Any && typeof channel.value === 'string') {
    const channelName = channel.value.toLowerCase();

    switch (channelName) {
      case 'h':
        return channelValues.h;
      case 's':
        return channelValues.s;
      case 'l':
        return channelValues.l;
      case 'alpha':
        return channelValues.alpha;
      default:
        throw new Error(`Invalid HSL channel reference: ${channelName}. Must be h, s, l, or alpha`);
    }
  }

  // If it's a Call node (like calc()), substitute channel variables and evaluate
  if (channel instanceof Call) {
    const substituted = substituteChannelVariables(channel, channelValues, 'hsl');
    const evaluated = await unwrapCalcChannelExpression(substituted).eval(context);

    // The result should be a Dimension
    if (evaluated instanceof Dimension) {
      const { number: value, unit } = evaluated.value;

      // Handle different units for hue (deg, turn, rad, grad)
      if (unit === 'deg' || unit === '' || unit === undefined) {
        // Normalize hue to 0-360
        return ((value % 360) + 360) % 360;
      } else if (unit === 'turn') {
        return ((value * 360 % 360) + 360) % 360;
      } else if (unit === 'rad') {
        return ((value * 180 / Math.PI % 360) + 360) % 360;
      } else if (unit === 'grad') {
        return ((value * 0.9 % 360) + 360) % 360;
      } else if (unit === '%') {
        // For s/l, percentage values are 0-100%, convert to 0-1
        return Math.max(0, Math.min(1, value / 100));
      } else {
        // For s/l without unit, assume 0-1 range
        return Math.max(0, Math.min(1, value));
      }
    }

    throw new Error(`Channel expression must evaluate to a Dimension, got ${evaluated.type}`);
  }

  // For other node types, try to evaluate and extract numeric value
  const evaluated = await channel.eval(context);
  if (evaluated instanceof Dimension) {
    const { number: value, unit } = evaluated.value;

    // Handle percentage units for s/l
    if (unit === '%') {
      return Math.max(0, Math.min(1, value / 100));
    }
    // For hue, normalize to 0-360
    if (unit === 'deg' || unit === '' || unit === undefined) {
      return ((value % 360) + 360) % 360;
    }
    // For other cases, return as-is (will be clamped by caller if needed)
    return value;
  }

  throw new Error(`Channel reference must be an identifier or evaluate to a Dimension, got ${channel.type}`);
}

/**
 * Evaluates an origin color node to a Color
 */
export async function evaluateOriginColor(
  originColorNode: Node,
  context: Context
): Promise<Color> {
  // Evaluate the origin color node
  const evaluated = await originColorNode.eval(context);

  // Cast to Color (it should be a Color, but might need conversion)
  if (evaluated instanceof Color) {
    return evaluated;
  }

  // Try to convert to Color if possible
  // This might need to be expanded based on what types can be converted to Color
  throw new Error(`Origin color must evaluate to a Color, got ${evaluated.type}`);
}
