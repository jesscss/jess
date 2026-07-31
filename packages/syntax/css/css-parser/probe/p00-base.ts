/** Probe: empty-ish baseline. One rule, one literal. */
import { literal, regex, rules } from 'parseman' with { type: 'macro' };

const whitespace = regex(/[ \t\n\r\f]+/);

export const probeGrammar = rules({ trivia: whitespace }, (_g) => {
  const Start = literal('a');

  return { Start };
});
