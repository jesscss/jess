import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { emitJess } from '@jesscss/core';
import { parse as parseLess } from '@jesscss/less-parser';
import { jessFunctions } from '@jesscss/plugin-less';
import { Compiler } from '../src/index.js';

/**
 * Ledger A20: `.jess` exposes variables with `@-expose brand;`, as Less does with
 * `@expose brand;`. A stylesheet compiles to the same `var(--…)` and the same
 * runtime recipe whether it is written in Less, converted from Less to `.jess`,
 * or written in `.jess` with live `$name` reads.
 */
type Language = 'less' | 'jess';

async function compiled(source: string, language: Language) {
  return new Compiler({}).renderToResult({ filePath: `entry.${language}`, source, language });
}

/** The CSS, runtime and error codes of a compile. */
async function outcome(source: string, language: Language) {
  const { css, runtime, errors } = await compiled(source, language);
  return { css, runtime, errors: errors.map(error => error.code) };
}

const LESS_FUNCTIONS = jessFunctions();

const EXPOSED: ReadonlyArray<readonly [string, string]> = [
  ['a value and a computed value', '@use "#less";\n@expose brand;\n@brand: #c00;\n.button { color: @brand; opacity: @less.lightness(@brand); }\n'],
  ['two names in calc()', '@expose brand, gap;\n@brand: #c00;\n@gap: 4px;\n.a { color: @brand; margin: calc(@gap * 2); }\n'],
  ['a read written before the @expose', '@brand: #c00;\n.a { color: @brand; }\n@expose brand;\n'],
  ['a read written before a later declaration', '@brand: red;\n.a { color: @brand; }\n@brand: blue;\n@expose brand;\n'],
  ['a percentage read as its ratio', '@use "#less";\n@expose r;\n@r: 10%;\n.x { v: rgb(@r, 0, 0); }\n'],
  ['an export of an export', '@use "#less";\n@expose a, b;\n@a: 10%;\n@b: @a;\n.x { v: rgb(@b, 0%, 0%); }\n'],
  ['functions with a CSS form', '@use "#less";\n@expose brand;\n@brand: #c00;\n.a { color: @less.fade(@brand, 50%); background: @less.darken(@brand, 10%); }\n'],
  ['a slash list a built-in reads', '@use "#less";\n@expose a;\n@a: 1/2;\n.x { b: @less.percentage(@a); c: @less.ceil(@a); }\n'],
];

const REJECTED: ReadonlyArray<readonly [string, string]> = [
  ['a name nothing declares', '@expose nope;\n.a { color: red; }\n'],
  ['an @expose below the top level', '@brand: red;\n.a { @expose brand; color: @brand; }\n']
];

describe('.jess @-expose (A20)', () => {
  /* The guiding round trip: .less → .css equals .less → .jess → .css. */
  it.each(EXPOSED)('a converted stylesheet compiles as its Less does: %s', async (_name, less) => {
    const jess = emitJess(parseLess(less), { functions: LESS_FUNCTIONS });
    expect(jess).toContain('@-expose ');
    const expected = await outcome(less, 'less');
    expect(expected).toMatchObject({ css: expect.stringContaining('var(--'), errors: [] });
    expect(await outcome(jess, 'jess'), jess).toEqual(expected);
  });

  it.each(REJECTED)('a converted stylesheet fails as its Less does: %s', async (_name, less) => {
    const jess = emitJess(parseLess(less), { functions: LESS_FUNCTIONS });
    const expected = await outcome(less, 'less');
    expect(expected).toMatchObject({ css: '', errors: [expect.stringMatching(/^eval\/expose-/)] });
    expect(await outcome(jess, 'jess'), jess).toEqual(expected);
  });

  /* Evaluation's expose errors spell the statement and the read as the stylesheet's dialect does. */
  it.each([
    ['less', '@expose nope;\n', {
      message: '@expose names @nope, which is not visible at the top level of this file',
      fix: 'Declare @nope at the top level of this file, or remove nope from the @expose.'
    }],
    ['jess', '@-expose nope;\n', {
      message: '@-expose names $nope, which is not visible at the top level of this file',
      fix: 'Declare $nope at the top level of this file, or remove nope from the @-expose.'
    }]
  ] as const)('names an undeclared exposed variable in %s spelling', async (language, source, text) => {
    const { errors } = await compiled(source, language);
    expect(errors).toEqual([expect.objectContaining({ code: 'eval/expose-not-declared', ...text })]);
  });

  /* Each statement is named as its own file writes it, so a .jess file that imports a .less one names both spellings. */
  it('names both expose statements of one name that name different variables, each in its own spelling', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jess-expose-conflict-'));
    try {
      fs.writeFileSync(path.join(dir, 'tokens.less'), '@brand: red;\n@expose brand;\n');
      fs.writeFileSync(path.join(dir, 'entry.jess'), '@-import "./tokens.less";\n$brand: blue;\n@-expose brand;\n');
      const { errors } = await new Compiler({}).renderToResult(path.join(dir, 'entry.jess'));
      expect(errors).toEqual([expect.objectContaining({
        code: 'eval/expose-conflict',
        message: '@expose brand names a different @brand than @-expose brand at entry.jess:3:10'
      })]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('names both @-expose names that are one JavaScript key', async () => {
    const { errors } = await compiled('$brand-: #c00;\n$brand: #00f;\n@-expose brand-, brand;\n', 'jess');
    expect(errors).toEqual([expect.objectContaining({
      code: 'eval/expose-key-conflict',
      message: '@-expose brand and @-expose brand- at entry.jess:3:10 are both brand in JavaScript'
    })]);
  });

  it.each([
    ['less', '@brand: red;\n.a { @expose brand; color: @brand; }\n', '@expose'],
    ['jess', '$brand: red;\n.a { @-expose brand; color: $brand; }\n', '@-expose']
  ] as const)('reports a nested expose in %s spelling', async (language, source, keyword) => {
    const { errors } = await compiled(source, language);
    expect(errors).toEqual([expect.objectContaining({
      code: 'eval/expose-not-top-level',
      message: `${keyword} is only allowed at the top level of a stylesheet`,
      fix: `Move the ${keyword} to the top level of the stylesheet, or import the file at its top level.`
    })]);
  });

  it.each([
    [
      '@use "#less";\n@expose brand;\n@brand: #c00;\n.button { color: @brand; opacity: @less.lightness(@brand); }\n',
      '@-use "#less";\n@-expose brand;\n$brand: #c00;\n.button { color: $brand; opacity: $less.lightness($brand); }\n'
    ],
    [
      '@expose brand, gap;\n@brand: #c00;\n@gap: 4px;\n.a { color: @brand; margin: calc(@gap * 2); }\n',
      '@-expose brand, gap;\n$brand: #c00;\n$gap: 4px;\n.a { color: $brand; margin: calc($gap * 2); }\n'
    ],
    [
      '@use "#less";\n@expose brand;\n@brand: #c00;\n.button { color: @brand; border-color: @less.darken(@brand, 10%); }\n',
      '@-use "#less";\n@-expose brand;\n$brand: #c00;\n.button { color: $brand; border-color: $less.darken($brand, 10%); }\n'
    ]
  ])('a .jess stylesheet with live reads compiles as the Less one does', async (less, jess) => {
    const written = await outcome(jess, 'jess');
    expect(written).toMatchObject({ css: expect.stringContaining('var(--brand, #c00)'), errors: [] });
    expect(written).toEqual(await outcome(less, 'less'));
  });
});
