import { defineForm } from '@jesscss/core/form';
import { RGB, type Fn, type ValueGroup } from '@jesscss/core/value';
import { COLOR_ARG } from './color-form.js';
import * as forms from './css-forms.generated.js';
import { WEIGHT_ARG, mixForm, type Weight } from './mix-form.js';

/** `mix(color1, color2, weight = 50%)`: `color-mix(in srgb, color1 weight, color2)`, in `rgb()` once translucent. */
export const mix: Fn = /* @__PURE__ */ defineForm('mix', {
  params: [COLOR_ARG, COLOR_ARG, WEIGHT_ARG],
  format: RGB,
  form: (a: ValueGroup, b: ValueGroup, weight?: Weight) => weight === undefined ? [forms.average, a, b] : mixForm(a, b, weight)
});
