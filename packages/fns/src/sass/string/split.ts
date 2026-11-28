import { define, checkKinds, optional } from '@jesscss/core/value';
import { createSassListResult } from '../list/util.js';
import { fuzzyInt } from '../math/random.js';
import { STRING_KINDS, codePoints, reString, stringText, type SassString } from './util.js';

/**
 * Sass `string.split($string, $separator, $limit: null)` — a bracketed,
 * comma-separated list of `$string`'s pieces, each quoted as `$string` is.
 * Module-only: Dart Sass has no global spelling.
 *
 * An empty `$string` is `[]`; an empty `$separator` splits into code points and
 * ignores `$limit`; `$limit` caps the number of splits, the rest of the string
 * staying in the last piece. `$limit` is an integer by Sass's fuzzy test and
 * its unit is ignored, as in Dart Sass.
 */
const split = define('split', {
  params: [
    { type: STRING_KINDS, check: checkKinds, name: 'string' },
    { type: STRING_KINDS, check: checkKinds, name: 'separator' },
    /* @__PURE__ */ optional({ type: ['Dimension', 'Null'], check: checkKinds, name: 'limit' })
  ] as const,
  body: (string: SassString, separator: SassString, limitArg) => {
    let limit: number | undefined;
    if (limitArg?.type === 'Dimension') {
      limit = fuzzyInt(limitArg.number);
      if (limit === undefined) {
        throw new TypeError(`$limit: ${limitArg.number}${limitArg.unit} is not an int.`);
      }
      if (limit < 1) {
        throw new RangeError(`$limit: Must be 1 or greater, was ${limit}.`);
      }
    }
    const text = stringText(string);
    const sep = stringText(separator);
    if (text === '') {
      return createSassListResult([], ',', true);
    }
    let chunks: string[];
    if (sep === '') {
      chunks = codePoints(text);
    } else {
      chunks = [];
      let from = 0;
      for (let at = text.indexOf(sep); at >= 0 && chunks.length !== limit; at = text.indexOf(sep, from)) {
        chunks.push(text.slice(from, at));
        from = at + sep.length;
      }
      chunks.push(text.slice(from));
    }
    return createSassListResult(chunks.map(chunk => reString(string, chunk)), ',', true);
  }
});

export default split;
