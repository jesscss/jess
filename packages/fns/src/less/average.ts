import { defineForm } from '@jesscss/core/form';
import type { Fn, ValueGroup } from '@jesscss/core/value';
import { COLOR_ARG } from './color-form.js';
import * as forms from './css-forms.generated.js';

/** `average(color1, color2)`: `color-mix(in srgb, color1, color2)`. */
export const average: Fn = /* @__PURE__ */ defineForm('average', {
  params: [COLOR_ARG, COLOR_ARG],
  form: (a: ValueGroup, b: ValueGroup) => [forms.average, a, b]
});
