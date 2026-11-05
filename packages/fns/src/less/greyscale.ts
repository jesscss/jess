import { defineForm, type Fn, type FormCall, type ValueGroup } from '@jesscss/core';
import { COLOR_ARG } from './color-form.js';
import { greyscale as form } from './css-forms.generated.js';

/** `greyscale(color)`: `hsl(from color h 0 l)`. */
export const greyscale: Fn = defineForm('greyscale', {
  params: [COLOR_ARG],
  form: (color: ValueGroup): FormCall => [form, color]
});
