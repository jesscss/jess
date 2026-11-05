import { defineForm, makeDimension, textOf, type Dimension, type Fn, type FormCall, type Keyword, type Quoted, type ValueGroup } from '@jesscss/core';

/** A colour a form's relative colour reads as its origin, or what only the browser knows of one. */
export const COLOR_ARG = { type: ['Color', 'FunctionCall'] } as const;

/** An amount in a channel, written as a number on that channel's scale, whatever its unit (css-color-5 §4.4). */
export const channelAmount = (amount: Dimension): Dimension => makeDimension(amount.number);

/** `name(color, amount, method?)` over its CSS form, and the form `method: relative` takes. */
export function defineAdjuster(name: string, absolute: FormCall[0], relative: FormCall[0]): Fn {
  return defineForm(name, {
    params: [COLOR_ARG, { type: 'Dimension' }, { type: ['Keyword', 'Quoted'], optional: true }],
    form: (color: ValueGroup, amount: Dimension, method?: Keyword | Quoted): FormCall =>
      [method !== undefined && textOf(method) === 'relative' ? relative : absolute, color, channelAmount(amount)]
  });
}
