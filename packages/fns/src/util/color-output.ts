import {
  Color,
  ColorFormat,
  type ColorData
} from '@jesscss/core';

type ColorAlpha = Color['value']['alpha'];

export function formatColorOutput(
  input: Color,
  format: ColorFormat,
  modernSyntax: boolean,
  alpha: ColorAlpha = input._alphaValue
): Color {
  const color = new Color({
    node: input.node,
    rgb: input._rgbChannels,
    hsl: input._hslChannels,
    alpha
  } satisfies ColorData, {
    ...input.options,
    format,
    modernSyntax
  }, input.location.length === 6 ? input.location : undefined).inherit(input);
  color.node = undefined;
  return color;
}
