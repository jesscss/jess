import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { serialize } from '@jesscss/core';
import { parse } from '@jesscss/less-parser';
import { parseWith, type LessAstGrammar } from '../src/parse-with.js';
import { commentTriviaLabels } from '../src/trivia-labels.js';
import {
  AST_VARIANTS,
  CST_VARIANTS,
  cstOutcome,
  ENGINES,
  loadEnginePair
} from '../../../css/css-parser/test/engine-parity.js';

const LIB = fileURLToPath(new URL('../lib', import.meta.url));

/**
 * The CSS base rules that spell a function body's padding clear trivia themselves,
 * so a comment beside a delimiter stays in the tree in every dialect composed on them.
 */
describe('Less keeps the comments a CSS function body spells', () => {
  it.each([
    'if(a: 1 /* c */, 2; else: 3)',
    'if(media(print): a /* c */ ; else: b)',
    'foo(a: 1 /* c */, 2; else: 3)'
  ])('%s', async (value) => {
    const { css } = await serialize(parse(`a { b: ${value}; }`));
    expect(css).toContain(`b: ${value};`);
  });
});

/** Less has `//` comments and CSS doesn't, so Less overrides that padding's slot. */
describe('Less reads a `//` comment before a delimiter in a function body', () => {
  it.each([
    ['color: if(\n  style(--dark: 1): white // dark theme\n  ;\n  else: black\n)', 'if(style(--dark: 1): white ; else: black)'],
    ['b: foo(size: 1px // body\n  , 2px)', 'foo(size: 1px , 2px)'],
    ['b: if(a: 1 // c\n, 2; else: 3)', 'if(a: 1 , 2; else: 3)'],
    ['b: if(a: 1 // c\n; else: 3)', 'if(a: 1 ; else: 3)'],
    ['b: foo(a: 1, 2 // c\n; b: 3)', 'foo(a: 1, 2 ; b: 3)'],
    ['b: if(a: 1; else: 2 // c\n;)', 'if(a: 1; else: 2 ;)'],
    ['b: if(a: 1 /* c */ // d\n /* e */, 2; else: 3)', 'if(a: 1 /* c */ /* e */, 2; else: 3)']
  ])('%j, on both engines', async (declaration, value) => {
    const source = `.a { ${declaration}; }`;
    for (const variant of AST_VARIANTS) {
      const engines = await loadEnginePair(LIB, variant);
      for (const engine of ENGINES) {
        const { css } = await serialize(parseWith(engines[engine] as LessAstGrammar, source));
        expect(css.replace(/\s+/g, ' ')).toContain(value);
      }
    }
    for (const variant of CST_VARIANTS) {
      const engines = await loadEnginePair(LIB, variant);
      for (const engine of ENGINES) {
        expect(cstOutcome(engines[engine], source, commentTriviaLabels)).toMatchObject({ ok: true });
      }
    }
  });
});
