import {
  Color,
  ColorFormat,
  type ColorData
} from '@jesscss/core';

type ColorAlpha = Color['_alphaValue'];

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
    // Source span is carried by `.inherit(input)` (provenance side-table);
    // nodes have no public `.location` field to pass here.
  }).inherit(input);
  color.node = undefined;
  return color;
}
