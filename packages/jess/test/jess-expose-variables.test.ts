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
  ['a value and a computed value', '@use "#less";\n@brand: #c00;\n@expose brand;\n.button { color: @brand; opacity: @less.lightness(@brand); }\n'],
  ['two names in calc()', '@brand: #c00;\n@gap: 4px;\n@expose brand, gap;\n.a { color: @brand; margin: calc(@gap * 2); }\n'],
  ['a read written before the @expose', '@brand: #c00;\n.a { color: @brand; }\n@expose brand;\n'],
  ['a read written before a later declaration', '@brand: red;\n.a { color: @brand; }\n@brand: blue;\n@expose brand;\n'],
  ['a percentage read as its ratio', '@use "#less";\n@r: 10%;\n@expose r;\n.x { v: rgb(@r, 0, 0); }\n'],
  ['an export of an export', '@use "#less";\n@a: 10%;\n@b: @a;\n@expose a, b;\n.x { v: rgb(@b, 0%, 0%); }\n'],
  ['functions with a CSS form', '@use "#less";\n@brand: #c00;\n@expose brand;\n.a { color: @less.fade(@brand, 50%); background: @less.darken(@brand, 10%); }\n'],
  ['a slash list a built-in reads', '@use "#less";\n@a: 1/2;\n@expose a;\n.x { b: @less.percentage(@a); c: @less.ceil(@a); }\n']
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

  it('rejects an @-expose above the declaration it names', async () => {
    const { css, errors } = await compiled('@-expose brand;\n$brand: red;\n.a { color: $brand; }\n', 'jess');
    expect({ css, errors }).toMatchObject({
      css: '',
      errors: [{ code: 'eval/expose-before-declaration', message: '@-expose names $brand before it is declared', fix: 'Move the @-expose below the declaration of $brand.' }]
    });
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
      '@use "#less";\n@brand: #c00;\n@expose brand;\n.button { color: @brand; opacity: @less.lightness(@brand); }\n',
      '@-use "#less";\n$brand: #c00;\n@-expose brand;\n.button { color: $brand; opacity: $less.lightness($brand); }\n'
    ],
    [
      '@brand: #c00;\n@gap: 4px;\n@expose brand, gap;\n.a { color: @brand; margin: calc(@gap * 2); }\n',
      '$brand: #c00;\n$gap: 4px;\n@-expose brand, gap;\n.a { color: $brand; margin: calc($gap * 2); }\n'
    ],
    [
      '@use "#less";\n@brand: #c00;\n@expose brand;\n.button { color: @brand; border-color: @less.darken(@brand, 10%); }\n',
      '@-use "#less";\n$brand: #c00;\n@-expose brand;\n.button { color: $brand; border-color: $less.darken($brand, 10%); }\n'
    ]
  ])('a .jess stylesheet with live reads compiles as the Less one does', async (less, jess) => {
    const written = await outcome(jess, 'jess');
    expect(written).toMatchObject({ css: expect.stringContaining('var(--brand, #c00)'), errors: [] });
    expect(written).toEqual(await outcome(less, 'less'));
  });
});

/**
 * Ledger A22 (owner 2026-11-19): a read of an exposed variable refers to the
 * variable, not to the value it holds where the read is written, so every read
 * is its `var()`, whose fallback is the value that read sees, and the runtime's
 * default is the variable's final value. A nested `$brand: blue;` declares a new
 * variable and stays its own value.
 */
describe('.jess reads of an exposed variable assigned more than once (A22)', () => {
  /** The warnings' codes, and their messages, of a compile. */
  const warned = (warnings: ReadonlyArray<{ code: string; message: string }>) => warnings.map(({ code, message }) => ({ code, message }));
  const REASSIGNED = { code: 'eval/expose-reassigned', message: '$brand is exposed and assigned more than once; set() sets its value for every read' };

  it('reads the variable before a later declaration of it', async () => {
    const { css, errors, warnings } = await compiled('$brand: red;\n@-expose brand;\n.button { color: $brand; }\n$brand: blue;\n.link { color: $brand; }\n', 'jess');
    expect(errors).toEqual([]);
    expect(css).toBe('.button {\n  color: var(--brand, red);\n}\n.link {\n  color: var(--brand, blue);\n}\n');
    expect(warned(warnings)).toEqual([REASSIGNED]);
  });

  it('reads the variable after a := reassignment of it, in a ruleset or at the top level', async () => {
    const { css, errors } = await compiled('$brand: #c00;\n@-expose brand;\n.button { color: $brand; }\n.dark { $brand := #f66; color: $brand; }\n.link { color: $brand; }\n', 'jess');
    expect(errors).toEqual([]);
    expect(css).toBe('.button {\n  color: var(--brand, #c00);\n}\n.dark {\n  color: var(--brand, #f66);\n}\n.link {\n  color: var(--brand, #f66);\n}\n');
  });

  it('computes a reassignment in terms of itself from the value it reaches', async () => {
    const { css, errors, runtime } = await compiled('$size: 10px;\n@-expose size;\n.a { width: $size; }\n$size := $($size * 2);\n.b { width: $size; }\n', 'jess');
    expect(errors).toEqual([]);
    expect(css).toBe('.a {\n  width: var(--size, 10px);\n}\n.b {\n  width: var(--size, 20px);\n}\n');
    expect(runtime?.exports).toEqual(['size']);
  });

  it('reads the variable into a computed value before a later declaration, with the final value as the runtime default', async () => {
    const { css, errors, runtime } = await compiled('@-use "#less";\n$brand: #c00;\n@-expose brand;\n.button { opacity: $less.lightness($brand); }\n$brand: #f80;\n.link { color: $brand; }\n', 'jess');
    expect(errors).toEqual([]);
    expect(css).toBe('.button {\n  opacity: var(--brand-lightness, 40%);\n}\n.link {\n  color: var(--brand, #f80);\n}\n');
    // eslint-disable-next-line @typescript-eslint/naming-convention -- custom property names
    expect(runtime?.derived).toEqual({ '--brand-lightness': expect.objectContaining({ args: [{ export: 'brand' }] }) });
    expect(runtime?.defaults).toEqual({ brand: '#f80' });
  });

  /* Without set(), the CSS is the stylesheet's own, each var() holding the value its read sees. */
  it.each([
    ['a later declaration', '$brand: #c00;\n.button { color: $brand; }\n$brand: #f80;\n.link { color: $brand; }\n'],
    ['a := in a ruleset', '$brand: #c00;\n.button { color: $brand; }\n.dark { $brand := #f66; color: $brand; }\n.link { border-color: $brand; }\n'],
    ['a ::= in a ruleset', '$brand: #c00;\n.button { color: $brand; }\n.dark { $brand ::= #f66; color: $brand; }\n.link { border-color: $brand; }\n']
  ])('writes the CSS the stylesheet compiles to without @-expose, read through var(), after %s', async (_name, source) => {
    const exposed = await compiled(source.replace('\n', '\n@-expose brand;\n'), 'jess');
    const plain = await compiled(source, 'jess');
    expect(exposed.errors).toEqual([]);
    expect(exposed.css).toContain('var(--brand, ');
    expect(exposed.css.replace(/var\(--brand, ([^()]*)\)/g, '$1')).toBe(plain.css);
  });

  it('holds the ratio each read of a percentage sees', async () => {
    const { css, errors } = await compiled('@-use "#less";\n$tint: 10%;\n@-expose tint;\n.a { color: rgb($tint, 0, 0); }\n$tint := 20%;\n.b { color: rgb($tint, 0, 0); }\n', 'jess');
    expect(errors).toEqual([]);
    expect(css).toBe('.a {\n  color: rgb(calc(var(--tint, 0.1) * 100%), 0, 0);\n}\n.b {\n  color: rgb(calc(var(--tint, 0.2) * 100%), 0, 0);\n}\n');
  });

  /* Owner 2026-11-19 (A22): until Jess has types no read may assume one, so a variable assigned a percentage and a length holds each as written. */
  it.each([
    ['in its frame', '$r := 5px;\n'],
    ['in a body', '.x { $r := 5px; }\n']
  ])('holds a variable assigned values of two kinds as written, assigned %s', async (_where, later) => {
    const { css, errors, runtime } = await compiled(`$r: 10%;\n@-expose r;\n.a { w: $r; }\n${later}.b { w: $r; }\n`, 'jess');
    expect(errors).toEqual([]);
    expect(css).toContain('.a {\n  w: var(--r, 10%);\n}\n');
    expect(css).toContain('.b {\n  w: var(--r, 5px);\n}\n');
    expect(runtime?.ratios).toEqual([]);
  });

  it('holds a percentage an importer overrides with a length as written', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jess-expose-kinds-'));
    try {
      fs.writeFileSync(path.join(dir, 'tokens.jess'), '$r: 10%;\n@-expose r;\n.a { w: $r; }\n');
      const filePath = path.join(dir, 'entry.jess');
      const source = '@-import "./tokens.jess";\n$r: 5px;\n.b { w: $r; }\n';
      const { css, errors, warnings } = await new Compiler({}).renderToResult({ filePath, source, language: 'jess' });
      expect(errors).toEqual([]);
      expect(warnings).toEqual([]);
      expect(css).toBe('.a {\n  w: var(--r, 10%);\n}\n.b {\n  w: var(--r, 5px);\n}\n');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('warns once for a variable it compiles again to hold as written', async () => {
    const { warnings } = await compiled('$r: 10%;\n@-expose r;\n.a { w: $r; }\n$r := 5px;\n.b { w: $r; }\n', 'jess');
    expect(warnings.map(warning => warning.code)).toEqual(['eval/expose-reassigned']);
  });

  it('still holds the ratio of a percentage computed, then assigned', async () => {
    const { css, errors } = await compiled('$r: $(5% * 2);\n@-expose r;\n.a { w: $r; }\n$r := 20%;\n.b { w: $r; }\n', 'jess');
    expect(errors).toEqual([]);
    expect(css).toBe('.a {\n  w: calc(var(--r, 0.1) * 100%);\n}\n.b {\n  w: calc(var(--r, 0.2) * 100%);\n}\n');
  });

  it('still holds the ratio of a percentage a body shadows with a length', async () => {
    const { css, errors } = await compiled('$r: 10%;\n@-expose r;\n.x { $r: 5px; w: $r; }\n.a { w: $r; }\n', 'jess');
    expect(errors).toEqual([]);
    expect(css).toBe('.x {\n  w: 5px;\n}\n.a {\n  w: calc(var(--r, 0.1) * 100%);\n}\n');
  });

  /* Orchestrator 2026-11-19: an importer's override of a variable a file it imports declares is deliberate, so only a second assignment in one file warns. */
  it.each([
    ['less', '@brand: #c00;\n@expose brand;\n', '@import "./tokens.less";\n', '@brand'],
    ['jess', '$brand: #c00;\n@-expose brand;\n', '@-import "./tokens.jess";\n', '$brand']
  ] as const)('does not warn when a %s importer overrides an exposed variable, and warns at its own second assignment', async (language, tokens, importer, symbol) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jess-expose-override-'));
    const sigil = symbol[0]!;
    try {
      fs.writeFileSync(path.join(dir, `tokens.${language}`), tokens);
      fs.writeFileSync(path.join(dir, `override.${language}`), `${importer}${sigil}brand: #f80;\n.button { color: ${symbol}; }\n`);
      fs.writeFileSync(path.join(dir, `twice.${language}`), `${importer}${sigil}brand: #f80;\n.button { color: ${symbol}; }\n${sigil}brand: #08f;\n`);
      const override = await new Compiler({}).renderToResult(path.join(dir, `override.${language}`));
      expect(override).toMatchObject({ css: '.button {\n  color: var(--brand, #f80);\n}\n', errors: [], warnings: [] });
      const twice = await new Compiler({}).renderToResult(path.join(dir, `twice.${language}`));
      expect(twice.errors).toEqual([]);
      expect(warned(twice.warnings)).toEqual([{ code: 'eval/expose-reassigned', message: `${symbol} is exposed and assigned more than once; set() sets its value for every read` }]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('leaves a nested shadow of the name its own value, with no warning', async () => {
    const { css, errors, warnings } = await compiled('$brand: #c00;\n@-expose brand;\n.button { color: $brand; }\n.dark { $brand: #f66; color: $brand; }\n', 'jess');
    expect(errors).toEqual([]);
    expect(css).toBe('.button {\n  color: var(--brand, #c00);\n}\n.dark {\n  color: #f66;\n}\n');
    expect(warnings).toEqual([]);
  });

  it.each([
    ['less', '@brand: #c00;\n@expose brand;\n.button { color: @brand; }\n@brand: #f80;\n', '@brand', '#f80'],
    ['jess', '$brand: #c00;\n@-expose brand;\n.button { color: $brand; }\n$brand := #f80;\n', '$brand', '#c00']
  ] as const)('warns once that a %s exposed variable is assigned more than once, and writes the same CSS', async (language, source, symbol, read) => {
    const { css, errors, warnings } = await compiled(source, language);
    expect(errors).toEqual([]);
    expect(css).toBe(`.button {\n  color: var(--brand, ${read});\n}\n`);
    expect(warned(warnings)).toEqual([{ code: 'eval/expose-reassigned', message: `${symbol} is exposed and assigned more than once; set() sets its value for every read` }]);
  });
});
