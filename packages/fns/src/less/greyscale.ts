import { defineForm, type FormCall } from '@jesscss/core/form';
import type { Fn, ValueGroup } from '@jesscss/core/value';
import { COLOR_ARG } from './color-form.js';
import { greyscale as form } from './css-forms.generated.js';

/** `greyscale(color)`: `hsl(from color h 0 l)`. */
export const greyscale: Fn = /* @__PURE__ */ defineForm('greyscale', {
  params: [COLOR_ARG],
  form: (color: ValueGroup): FormCall => [form, color]
});
