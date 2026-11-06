import { asNumber, defineForm, type FormCall } from '@jesscss/core/form';
import { makeDimension, type Dimension, type Fn, type FunctionCall, type ValueGroup } from '@jesscss/core/value';
import { spin } from '../../less/css-forms.generated.js';
import { COLOR, EXCESS } from './color-form.js';
import { degreesOf, noExcess } from './kernels.js';

/**
 * `color.adjust-hue(color, degrees)` — rotate the hue, wrapped to 0-360.
 *
 * dart-sass: `adjust-hue(#800, 45)` → `#886600`; `adjust-hue(#800, 45deg)` →
 * `#886600`; `adjust-hue(#800, -45)` → `#880066`;
 * `adjust-hue(hsl(120,50%,50%), 45)` → `hsl(165, 50%, 50%)`.
 *
 * Same computation as Less's `spin`, different dispatch name — a Sass-owned
 * definition rather than a re-export of the Less callable.
 */
export const adjustHue: Fn = /* @__PURE__ */ defineForm('adjust-hue', {
  params: [COLOR, { name: 'degrees', type: ['Dimension', 'FunctionCall'] }, EXCESS],
  form: (color: ValueGroup, degrees: Dimension | FunctionCall, excess?: ValueGroup): FormCall => {
    noExcess(excess, 2);
    return [spin, color, degrees.type === 'Dimension' ? makeDimension(degreesOf(degrees)) : asNumber(degrees)];
  }
});

export default adjustHue;
