import { define, checkAny } from '@jesscss/core/value';
import { appendSelectors } from './compose.js';

const append = define('append', {
  params: [{ name: 'selectors', type: 'any', check: checkAny }] as const,
  variadic: true,
  body: appendSelectors
});

export default append;
