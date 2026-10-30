import { describe, expect, it } from 'vitest';
import type { AbstractPlugin } from '@jesscss/core';
import { CssPlugin } from '@jesscss/compiler-preset';
import lessPlugin from '@jesscss/plugin-less';
import scssPlugin from '@jesscss/plugin-scss';
import jessPlugin from '@jesscss/plugin-jess';
import { Compiler } from '../src/index.js';

/**
 * An `@supports` prelude that is no `<supports-condition>` parses in every
 * dialect and then fails the compile with one `css/invalid-supports-condition`
 * error at the at-rule (owner 2026-10-22, on `@supports selector (a)`: *"It's
 * not the CSS function, and you said that CSS wouldn't recognize it with a
 * space"*; ledger P45, the P47 shape: parseable is not compiles).
 * `selector (a)` is the identifier `selector` and a `(a)` group, never the
 * `selector(` function (css-syntax-3 §4.3.4).
 */
type Dialect = 'css' | 'less' | 'scss' | 'jess';
const DIALECTS = ['css', 'less', 'scss', 'jess'] as const;

const PLUGINS: Record<Dialect, AbstractPlugin> = {
  css: new CssPlugin(),
  less: lessPlugin(),
  scss: scssPlugin(),
  jess: jessPlugin()
};

const CODE = 'css/invalid-supports-condition';

/** The at-rule sits on line 2, column 1. */
const sheet = (prelude: string): string => `a { b: c; }\n@supports ${prelude} {\n  .a { b: c; }\n}\n`;

/*
 * `or not (…)` and `not (…) and (…)` put a connective where an operand
 * belongs (css-conditional-3 needs `or (not (…))` and `(not (…)) and (…)`),
 * `and` and `or` do not mix without a group (`((…) and (…)) or (…)`), and a
 * condition has no comma list.
 */
const PRELUDES = ['selector (a)', 'color', '(display: grid) or not (display: flex)', 'not (display: grid) and (display: flex)', '(display: grid) and (display: flex) or (display: block)', '(display: grid), (display: flex)'];

describe('an @supports prelude that is no condition parses', () => {
  for (const dialect of DIALECTS) {
    it.each(PRELUDES)(`${dialect}: @supports %s`, (prelude) => {
      const result = PLUGINS[dialect].safeParse!(`/proj/supports.${dialect}`, sheet(prelude));
      expect(result.errors).toEqual([]);
      expect(result.document).toBeDefined();
    });
  }
});

describe('an @supports prelude that is no condition fails the compile', () => {
  for (const dialect of DIALECTS) {
    it.each(PRELUDES)(`${dialect}: @supports %s`, async (prelude) => {
      const result = await new Compiler({}).renderToResult({ source: sheet(prelude), filePath: `/proj/supports.${dialect}` }, { suppressWarnings: true });
      expect(result.css).toBe('');
      expect(result.errors.map(error => [error.code, error.phase, error.line, error.column])).toEqual([[CODE, 'parse', 2, 1]]);
    });
  }
});

/*
 * A CSS `@import`'s `supports(…)` condition is the same condition. SCSS reads
 * it as one (the other dialects keep an import's tail as written text), so it
 * parses and fails the compile the same way, at the import.
 */
const IMPORT_CONDITIONS = ['color', 'not (display: grid) and (display: flex)', '(display: grid) and (display: flex) or (display: block)'];
const importSheet = (condition: string): string => `@import "a.css" supports(${condition});\na { b: c; }\n`;

describe('an scss @import supports() condition that is no condition', () => {
  it.each(IMPORT_CONDITIONS)('parses: supports(%s)', (condition) => {
    const result = PLUGINS.scss.safeParse!('/proj/import.scss', importSheet(condition));
    expect(result.errors).toEqual([]);
    expect(result.document).toBeDefined();
  });

  it.each(IMPORT_CONDITIONS)('fails the compile: supports(%s)', async (condition) => {
    const result = await new Compiler({}).renderToResult({ source: importSheet(condition), filePath: '/proj/import.scss' }, { suppressWarnings: true });
    expect(result.css).toBe('');
    expect(result.errors.map(error => [error.code, error.phase, error.line, error.column])).toEqual([[CODE, 'parse', 1, 1]]);
  });

  it.each(['display: grid', 'selector(a > b)', '(display: grid) or (display: flex)', 'not (display: grid)'])('compiles: supports(%s)', async (condition) => {
    await expect(new Compiler({}).renderString(importSheet(condition), { filePath: '/proj/import.scss' }))
      .resolves.toBe(`@import "a.css" supports(${condition});\na {\n  b: c;\n}\n`);
  });
});

describe('a supports condition still compiles', () => {
  /* The `selector()` function and a condition joined by a connective are written as `.css` writes them. */
  it.each(DIALECTS)('%s', async (dialect) => {
    const source = '@supports selector(a > b) and (display: grid) and (display: flex) {\n  .a { b: c; }\n}\n@supports (display: grid) or (display: flex) or (display: block) {\n  .a { b: c; }\n}\n';
    const css = await new Compiler({}).renderString(source, { filePath: '/proj/supports.css' });
    await expect(new Compiler({}).renderString(source, { filePath: `/proj/supports.${dialect}` })).resolves.toBe(css);
  });

  /* Inside a condition's parentheses what is no condition is general-enclosed content, kept as written. */
  it.each(DIALECTS)('%s: a general-enclosed group of identifiers', async (dialect) => {
    const source = '@supports (display: grid) or (font-tech  color-colrv1) {\n  .a { b: c; }\n}\n';
    const css = await new Compiler({}).renderString(source, { filePath: '/proj/supports.css' });
    expect(css).toContain('(font-tech  color-colrv1)');
    await expect(new Compiler({}).renderString(source, { filePath: `/proj/supports.${dialect}` })).resolves.toBe(css);
  });

  it.each(DIALECTS)('%s: a general-enclosed `not` chain in a group', async (dialect) => {
    const source = '@supports (not (display: grid)  and (display: flex)) {\n  .a { b: c; }\n}\n';
    const css = await new Compiler({}).renderString(source, { filePath: '/proj/supports.css' });
    expect(css).toContain('(not (display: grid)  and (display: flex))');
    await expect(new Compiler({}).renderString(source, { filePath: `/proj/supports.${dialect}` })).resolves.toBe(css);
  });
});
