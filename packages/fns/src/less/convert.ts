import { defineForm, formNumber, type FormCall } from '@jesscss/core/form';
import { groupOf, isCssUnit, textOf, unitFactor, checkKinds, type Dimension, type Fn, type FunctionCall, type Keyword, type Quoted, type ValueGroup } from '@jesscss/core/value';
import { isDimension, NUMBER_ARG } from './css-math-args.js';
import { convert as form } from './css-forms.generated.js';

/** A known `value` in `target` when they share a unit group; else unchanged, still a computed result with canonical bytes. */
function converted(value: Dimension, target: string): Dimension {
  const from = value.unit;
  const group = groupOf(from);
  return from && target && from !== target && group !== undefined && group === groupOf(target)
    ? formNumber(value.number * (unitFactor(from)! / unitFactor(target)!), target)
    : formNumber(value.number, from);
}

/**
 * `convert(value, unit)`: `calc(value)`, the same CSS quantity, a known one spelled
 * in `unit`. A unit only the browser knows, or one CSS does not define, has no CSS form.
 */
export const convert: Fn = /* @__PURE__ */ defineForm('convert', {
  params: [NUMBER_ARG, { type: ['Keyword', 'Quoted', 'FunctionCall'], check: checkKinds }],
  form: (value: ValueGroup, to: Keyword | Quoted | FunctionCall): FormCall => {
    if (to.type === 'FunctionCall') {
      throw new TypeError('convert: a unit only the browser knows cannot pick a form');
    }
    if (!isDimension(value) && !isCssUnit(textOf(to))) {
      throw new TypeError(`convert: CSS defines no unit "${textOf(to)}"`);
    }
    return [form, isDimension(value) ? converted(value, textOf(to)) : value];
  }
});
