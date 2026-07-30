import { defineFunction, isBracketedList, makeBool } from '@jesscss/core';

/** Sass `list.is-bracketed()` reads the shared Block delimiter fact. */
const isBracketed = defineFunction('is-bracketed', {
  params: [{ name: 'list', type: 'any' }] as const,
  body: list => makeBool(isBracketedList(list))
});

export default isBracketed;
