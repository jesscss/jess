import { asNumber, defineForm, formNumber, type FormCall } from '@jesscss/core/form';
import { isCssUnit, isValueGroupArray, textOf, type Fn, type FunctionCall, type Keyword, type Quoted, type ValueGroup } from '@jesscss/core/value';
import { isDimension, NUMBER_ARG, turnsInto } from './css-math-args.js';
import { unit as form } from './css-forms.generated.js';

const targetOf = (to: ValueGroup | undefined): string =>
  to === undefined || isValueGroupArray(to) || (to.type !== 'Keyword' && to.type !== 'Quoted') ? '' : textOf(to);

/**
 * `unit(value, unit?)`: `calc(value * 1unit)`, replacing a known value's unit, or
 * with no unit stripping it. A unit only the browser knows, or one CSS does not
 * define, has no CSS form.
 */
export const unit: Fn = /* @__PURE__ */ defineForm('unit', {
  params: [
    { ...NUMBER_ARG, fits: (value: ValueGroup, slots: readonly ValueGroup[]): boolean => turnsInto(value, targetOf(slots[1])) },
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
