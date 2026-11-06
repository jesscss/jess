/**
 * Sass's colour built-ins over Less's CSS forms: the form is the same CSS, and
 * what stays Sass's is what it reads and rejects (the kernels' range checks,
 * arity, and an amount of alpha on 0–1).
 */
import { asNumber, defineForm, knownUnit, type FormCall } from '@jesscss/core/form';
import { makeDimension, type Dimension, type Fn, type FunctionCall, type ValueGroup } from '@jesscss/core/value';
import { channelAmount } from '../../less/color-form.js';
import { fractionAmount, noExcess, percentAmount } from './kernels.js';

export const COLOR = { name: 'color', type: ['Color', 'FunctionCall'] } as const;
export const AMOUNT = { name: 'amount', type: ['Dimension', 'FunctionCall'] } as const;
export const EXCESS = { name: 'excess', type: 'any', optional: true } as const;

/** `name(color, amount)` on a channel's 0–100 scale, an amount only the browser knows taken to hold a percentage (Q2). */
/* @__NO_SIDE_EFFECTS__ */
export function defineAdjuster(name: string, form: FormCall[0], deferred: FormCall[0]): Fn {
  return defineForm(name, {
    params: [COLOR, AMOUNT, EXCESS],
    form: (color: ValueGroup, amount: Dimension | FunctionCall, excess?: ValueGroup): FormCall => {
      noExcess(excess, 2);
      if (amount.type === 'Dimension') {
        percentAmount(amount);
        return [form, color, channelAmount(amount)];
      }
      const unit = knownUnit(amount);
      return unit === undefined || unit === '%' ? [deferred, color, amount] : [form, color, asNumber(amount, unit)];
    }
  });
}

/** `name(color, amount)` for an amount of alpha, a plain number on 0–1. */
/* @__NO_SIDE_EFFECTS__ */
export function defineAlphaAdjuster(name: string, form: FormCall[0]): Fn {
  return defineForm(name, {
    params: [COLOR, AMOUNT, EXCESS],
    form: (color: ValueGroup, amount: Dimension | FunctionCall, excess?: ValueGroup): FormCall => {
      noExcess(excess, 2);
      return [form, color, amount.type === 'Dimension' ? makeDimension(fractionAmount(amount)) : amount];
    }
  });
}
