import { defineFunction } from '@jesscss/core';
import type { Dimension } from '@jesscss/core';
import { STRING_KINDS, codePoints, codepointForIndex, requireIntIndex, reString, stringText, type SassString } from './util.js';

/**
 * Sass `string.insert()` — the `str-insert()` global.
 *
 * Inserts `$insert` so that it STARTS at `$index` in the result; quoting comes
 * from `$string` alone (`str-insert(Hello,"X",3)` → `HeXllo`). A negative index
 * counts from the end and gets the two-step correction dart-sass documents (one
 * because `-1` is the last character rather than an offset, one because the
 * insert lands AFTER it). Verified against dart-sass 1.101.0:
 *
 * ```
 * str-insert("Hello","X",3)  → "HeXllo"   str-insert("Hello","X",-1)   → "HelloX"
 * str-insert("Hello","X",1)  → "XHello"   str-insert("Hello","X",-2)   → "HellXo"
 * str-insert("Hello","X",0)  → "XHello"   str-insert("Hello","X",100)  → "HelloX"
 * str-insert(Hello,X,3)      → HeXllo     str-insert("Hello","X",-100) → "XHello"
 * ```
 */
const insert = defineFunction('insert', {
  params: [
    { name: 'string', type: STRING_KINDS },
    { name: 'insert', type: STRING_KINDS },
    { name: 'index', type: 'Dimension' }
  ] as const,
  body: (string: SassString, insertValue: SassString, index: Dimension) => {
    const chars = codePoints(stringText(string));
    const wanted = requireIntIndex('index', index.number, index.unit);
    const oneBased = wanted < 0 ? Math.max(chars.length + wanted + 2, 0) : wanted;
    const at = codepointForIndex(oneBased, chars.length);
    const text = `${chars.slice(0, at).join('')}${stringText(insertValue)}${chars.slice(at).join('')}`;
    return reString(string, text);
  }
});

export default insert;
