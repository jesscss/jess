import { defineForm, formNumber, type FormCall } from '@jesscss/core/form';
import { textOf, type Dimension, type Fn, type FunctionCall as WrittenCall, type Keyword, type Quoted, type ValueGroup } from '@jesscss/core/value';

/** A colour a form's relative colour reads as its origin, or what only the browser knows of one. */
export const COLOR_ARG = { type: ['Color', 'FunctionCall'], formSlot: 'color' } as const;

/** An amount in a channel, written as a number on that channel's scale, whatever its unit (css-color-5 §4.4). */
export const channelAmount = (amount: Dimension): Dimension => formNumber(amount.number);

/** `name(color, amount, method?)` over its CSS form, and the form `method: relative` takes; each with a form for an amount only the browser knows, taken to hold a percentage (Q2). */
/* @__NO_SIDE_EFFECTS__ */
export function defineAdjuster(name: string, absolute: FormCall[0], relative: FormCall[0], absoluteDeferred: FormCall[0], relativeDeferred: FormCall[0]): Fn {
  return defineForm(name, {
    params: [COLOR_ARG, { type: ['Dimension', 'FunctionCall'], formSlot: '%' }, { type: ['Keyword', 'Quoted', 'FunctionCall'], optional: true }],
    form: (color: ValueGroup, amount: Dimension | WrittenCall, method?: Keyword | Quoted | WrittenCall): FormCall => {
      if (method?.type === 'FunctionCall') {
        throw new TypeError(`${name}: a method only the browser knows cannot pick a form`);
      }
      const isRelative = method !== undefined && textOf(method) === 'relative';
      return amount.type === 'FunctionCall'
        ? [isRelative ? relativeDeferred : absoluteDeferred, color, amount]
        : [isRelative ? relative : absolute, color, channelAmount(amount)];
    }
  });
}
