import { Parser } from '../src/index.js';
import { serializeTypes } from '@jesscss/core';

const parser = new Parser();

/**
 * CSS escape sequences in selectors (from the `css-escapes` Less fixture).
 *
 * A backslash escape — `\` + any non-newline char, or `\` + 1–6 hex digits with an
 * optional trailing space — is part of an identifier/selector token (CSS Syntax §4.3.7)
 * and must survive verbatim into the built selector node. These all parse with 0 errors
 * and the escape is preserved in the tree.
 */
describe('CSS escape sequences in selectors', () => {
  const cases: Array<[string, string, string]> = [
    ['escaped pipe in class', '.escape\\|random\\|char { color: red }', '.escape\\|random\\|char'],
    ['escaped bang in class', '.mixin\\!tUp { font-weight: bold }', '.mixin\\!tUp'],
    ['trailing escaped plus', '.trailingTest\\+ { color: red }', '.trailingTest\\+'],
    ['escaped leading digit', '.\\34 04 { background: red }', '.\\34 04'],
    ['hex type selector', '\\62\\6c\\6f \\63 { color: silver }', '\\62\\6c\\6f'],
    ['escaped colon in type', 'ng\\:form { display: none }', 'ng\\:form'],
    ['escaped colon in attribute', '[ng\\:cloak] { display: none }', 'ng\\:cloak']
  ];

  for (const [name, src, escape] of cases) {
    it(`parses and preserves ${name}`, () => {
      const { errors, tree } = parser.parse(src);
      expect(errors.length).toBe(0);
      expect(tree?.rules?.length ?? 0).toBeGreaterThan(0);
      expect(serializeTypes(tree)).toContainString(escape);
    });
  }
});
