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

/** The CSS and runtime of a compile, or the code of the error it stops with. */
async function outcome(source: string, language: Language): Promise<unknown> {
  try {
    const { css, runtime } = await compiled(source, language);
    return { css, runtime };
  } catch (error) {
    return { code: error instanceof Error && 'code' in error ? error.code : error };
  }
}

const LESS_FUNCTIONS = jessFunctions();

const EXPOSED: ReadonlyArray<readonly [string, string]> = [
  ['a value and a computed value', '@use "#less";\n@expose brand;\n@brand: #c00;\n.button { color: @brand; opacity: @less.lightness(@brand); }\n'],
  ['two names in calc()', '@expose brand, gap;\n@brand: #c00;\n@gap: 4px;\n.a { color: @brand; margin: calc(@gap * 2); }\n'],
  ['a read written before the @expose', '@brand: #c00;\n.a { color: @brand; }\n@expose brand;\n'],
  ['a percentage read as its ratio', '@use "#less";\n@expose r;\n@r: 10%;\n.x { v: rgb(@r, 0, 0); }\n'],
  ['an export of an export', '@use "#less";\n@expose a, b;\n@a: 10%;\n@b: @a;\n.x { v: rgb(@b, 0%, 0%); }\n'],
  ['functions with a CSS form', '@use "#less";\n@expose brand;\n@brand: #c00;\n.a { color: @less.fade(@brand, 50%); background: @less.darken(@brand, 10%); }\n'],
  ['a slash list a built-in reads', '@use "#less";\n@expose a;\n@a: 1/2;\n.x { b: @less.percentage(@a); c: @less.ceil(@a); }\n'],
  ['a name nothing declares', '@expose nope;\n.a { color: red; }\n'],
  ['an @expose below the top level', '@brand: red;\n.a { @expose brand; color: @brand; }\n']
];

describe('.jess @-expose (A20)', () => {
  /* The guiding round trip: .less → .css equals .less → .jess → .css. */
  it.each(EXPOSED)('a converted stylesheet compiles as its Less does: %s', async (_name, less) => {
    const jess = emitJess(parseLess(less), { functions: LESS_FUNCTIONS });
    expect(jess).toContain('@-expose ');
    expect(await outcome(jess, 'jess'), jess).toEqual(await outcome(less, 'less'));
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
    const written = await compiled(jess, 'jess');
    expect(written.css).toContain('var(--brand, #c00)');
    expect({ css: written.css, runtime: written.runtime }).toEqual(await outcome(less, 'less'));
  });
});
