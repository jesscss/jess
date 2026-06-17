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
  alpha: ColorAlpha = input.value.alpha
): Color {
  const color = new Color({
    ...input.value,
    alpha
  } satisfies ColorData, {
    ...input.options,
    format,
    modernSyntax
  }, input.location.length === 6 ? input.location : undefined).inherit(input);
  color.value.node = undefined;
  return color;
}
