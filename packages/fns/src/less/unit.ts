import { asNumber, defineForm, formNumber, type FormCall } from '@jesscss/core/form';
import { isCssUnit, textOf, type Fn, type FunctionCall, type Keyword, type Quoted, type ValueGroup } from '@jesscss/core/value';
import { isDimension, NUMBER_ARG } from './css-math-args.js';
import { unit as form } from './css-forms.generated.js';

/**
 * `unit(value, unit?)`: `calc(value * 1unit)`, replacing a known value's unit, or
 * with no unit stripping it. A unit only the browser knows, or one CSS does not
 * define, has no CSS form.
 */
export const unit: Fn = /* @__PURE__ */ defineForm('unit', {
  params: [
    NUMBER_ARG,
    { type: ['Keyword', 'Quoted', 'FunctionCall'], optional: true }
  ],
  form: (value: ValueGroup, to?: Keyword | Quoted | FunctionCall): FormCall => {
    if (to?.type === 'FunctionCall') {
      throw new TypeError('unit: a unit only the browser knows cannot pick a form');
    }
    const target = to === undefined ? '' : textOf(to);
    if (!isDimension(value) && !isCssUnit(target)) {
      throw new TypeError(`unit: CSS defines no unit "${target}"`);
    }
    return [form, isDimension(value) ? formNumber(value.number) : asNumber(value), formNumber(1, target)];
  }
});
