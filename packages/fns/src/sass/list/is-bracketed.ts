import { isBracketedList, makeBool, define, checkAny } from '@jesscss/core/value';

/** Sass `list.is-bracketed()` reads the shared Block delimiter fact. */
const isBracketed = define('is-bracketed', {
  params: [{ name: 'list', type: 'any', check: checkAny }] as const,
  body: list => makeBool(isBracketedList(list))
});

export default isBracketed;
