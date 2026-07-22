import { defineFunction, isBracketedList, makeBool } from '@jesscss/core/value';

/** Sass `list.is-bracketed()` reads the shared Block delimiter fact. */
const isBracketed = defineFunction('is-bracketed', {
  params: [{ name: 'list', kinds: 'any' }] as const,
  body: list => makeBool(isBracketedList(list))
});

export default isBracketed;
