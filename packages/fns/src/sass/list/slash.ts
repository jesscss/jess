import { define, checkAny, rest } from '@jesscss/core/value';
import { createSassListResult } from './util.js';

/**
 * Sass `list.slash($elements...)` — a slash-separated list of its arguments.
 * Module-only: Dart Sass has no global spelling.
 */
const slash = define('slash', {
  params: [rest({ name: 'elements', type: 'any', check: checkAny })] as const,
  body: (elements) => {
    if (elements.length < 2) {
      throw new Error('At least two elements are required.');
    }
    return createSassListResult(elements, '/', false);
  }
});

export default slash;
