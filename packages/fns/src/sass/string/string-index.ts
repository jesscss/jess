import { defineFunction, makeDimension } from '@jesscss/core';
import { NIL, STRING_KINDS, codePoints, stringText, type SassString } from './util.js';

/**
 * Sass `string.index()` — the `str-index()` global.
 *
 * Returns the ONE-BASED code-point index of the first `$substring` occurrence,
 * or Sass `null` when it does not occur. dart-sass 1.101.0:
 * `str-index("Hello","ll")` → `3`, `str-index("Hello","H")` → `1`,
 * `str-index("Hello","")` → `1`, `str-index("😊abc","abc")` → `2` (code points,
 * not UTF-16 units), `str-index("Hello","x")` → `null`.
 *
 * The `null` answer DROPS the declaration in dart-sass; jess has no such
 * serializer rule, so the {@link NIL} result emits as an empty value instead.
 * The filename avoids clashing with this folder's `index.ts` barrel, exactly as
 * `sass/list/list-index.ts` does.
 */
const stringIndex = defineFunction('index', {
  params: [
    { name: 'string', type: STRING_KINDS },
    { name: 'substring', type: STRING_KINDS }
  ] as const,
  body: (string: SassString, substring: SassString) => {
    const text = stringText(string);
    const at = text.indexOf(stringText(substring));
    return at === -1 ? NIL : makeDimension(codePoints(text.slice(0, at)).length + 1);
  }
});

export default stringIndex;
