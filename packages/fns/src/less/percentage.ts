import { asNumber, defineForm, formNumber, knownUnit, type FormCall } from '@jesscss/core/form';
import { groupOf, type Fn, type ValueGroup } from '@jesscss/core/value';
import { normalizeAngle } from '../shared/math/math-helper.js';
import { isDimension, NUMBER_ARG } from './css-math-args.js';
import { percentage as form } from './css-forms.generated.js';

/** What only the browser knows of a value, as `percentage()` reads it: its known unit dropped, an angle as radians. */
function dropped(value: ValueGroup): ValueGroup {
  const unit = knownUnit(value);
  return asNumber(value, unit !== undefined && groupOf(unit) === groupOf('rad') ? 'rad' : unit);
}

/** `percentage(value)`: `calc(value * 100%)`, a known value's unit dropped (an angle as radians). */
export const percentage: Fn = /* @__PURE__ */ defineForm('percentage', {
  params: [NUMBER_ARG],
  form: (value: ValueGroup): FormCall => [form, isDimension(value) ? formNumber(normalizeAngle(value)) : dropped(value)]
});
