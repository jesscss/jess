import { define, checkAny } from '@jesscss/core/value';
import { nestSelectors } from './compose.js';

const nest = define('nest', {
  params: [{ name: 'selectors', type: 'any', check: checkAny }] as const,
  variadic: true,
  body: nestSelectors
});

export default nest;
