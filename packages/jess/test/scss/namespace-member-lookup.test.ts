import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { emitJess } from '@jesscss/core';
import { parse as parseJess } from '@jesscss/jess-parser';
import { parse as parseScss } from '@jesscss/scss-parser';
import { Compiler } from '../../src/index.js';

/**
 * `.scss` `ns.$name` reads the variable `name` of the module `@use` bound to
 * `ns` (`sass:math`, a user module, `@use … as x`). It is the member lookup
 * `.jess` writes `$ns.name` (ledger R7) and parses to that same tree, so it
 * evaluates through the one member-lookup path and converts to `$ns.name`.
 * Expected CSS is sass-spec's (section named) or, where none exists, Dart Sass
 * 1.101.7's output for the same input.
 */
const files = (entries: ReadonlyArray<readonly [name: string, source: string]>): string => {
  const dir = mkdtempSync(join(tmpdir(), 'jess-scss-member-'));
  for (const [name, source] of entries) {
    writeFileSync(join(dir, name), source);
  }
  return dir;
};
const render = (dir: string, entry: string): Promise<string> =>
  new Compiler({}).render(join(dir, entry), { suppressWarnings: true });
const renderScss = (source: string): Promise<string> =>
  new Compiler({}).renderString(source, { extension: '.scss', suppressWarnings: true });

/* Ignore what differs by spelling alone: the authored bytes and source offsets. */
const shape = (source: string, parse: (s: string) => unknown): string =>
  JSON.stringify(parse(source), (key, value: unknown) => (key === 'raw' || key === '_s' || key === '_e' ? undefined : value));

describe('.scss ns.$name is the .jess member lookup', () => {
  it.each([
    ['a { b: math.$pi; }', 'a { b: $math.pi; }'],
    ['a { b: v.$max-gap; }', 'a { b: $v.max-gap; }']
  ])('%s parses to the tree .jess builds for %s', (scss, jess) => {
    expect(shape(scss, parseScss)).toBe(shape(jess, parseJess));
  });

  it.each([
    ['core_functions/math/variables.hrx § e', 'a {b: math.$e * 1e15}', '2718281828459045'],
    ['core_functions/math/variables.hrx § pi', 'a {b: math.$pi * 1e15}', '3141592653589793'],
    ['core_functions/math/variables.hrx § epsilon', 'a {b: math.$epsilon * 1e31}', '2220446049250313'],
    ['core_functions/math/variables.hrx § max_safe_integer', 'a {b: math.$max-safe-integer}', '9007199254740991'],
    ['core_functions/math/variables.hrx § min_safe_integer', 'a {b: math.$min-safe-integer}', '-9007199254740991']
  ])('%s', async (_section, source, expected) => {
    await expect(renderScss(`@use "sass:math";\n${source}`)).resolves.toBe(`a {\n  b: ${expected};\n}\n`);
  });

  it('reads a sass:math variable in interpolation, as a function argument and through `as`', async () => {
    await expect(renderScss('@use "sass:math";\n.a { b: #{math.$pi}; c: math.round(math.$e); d: "x#{math.$e}"; }')).resolves.toBe(
      '.a {\n  b: 3.1415926536;\n  c: 3;\n  d: "x2.7182818285";\n}\n'
    );
    await expect(renderScss('@use "sass:math" as m;\n.a { b: m.$pi; c: m.div(10px, 4); }')).resolves.toBe(
      '.a {\n  b: 3.1415926536;\n  c: 2.5px;\n}\n'
    );
  });

  it('directives/use/member/namespaced.hrx § default/variable_use', async () => {
    const dir = files([['other.scss', '$member: value;\n'], ['input.scss', '@use "other";\n\na {b: other.$member}\n']]);
    await expect(render(dir, 'input.scss')).resolves.toBe('a {\n  b: value;\n}\n');
  });

  it('directives/use/with/single.hrx, read through the namespace', async () => {
    const dir = files([
      ['_other.scss', '$a: original !default;\n$b: kept !default;\n'],
      ['input.scss', '@use "other" with ($a: configured);\nb {c: other.$a; d: other.$b}\n']
    ]);
    await expect(render(dir, 'input.scss')).resolves.toBe('b {\n  c: configured;\n  d: kept;\n}\n');
  });

  it('reads a user module through `@use … as x`', async () => {
    const dir = files([['_vars.scss', '$gap: 4px;\n'], ['input.scss', '@use "vars" as v;\n.a { gap: v.$gap * 2; }\n']]);
    await expect(render(dir, 'input.scss')).resolves.toBe('.a {\n  gap: 8px;\n}\n');
  });

  it('reports an unknown member at the read', async () => {
    await expect(renderScss('@use "sass:math";\n.a { b: math.$nope; }')).rejects.toMatchObject({
      code: 'resolve/name-not-found',
      line: 2,
      column: 9
    });
  });
});

describe('.scss ns.$name converts to .jess $ns.name', () => {
  it('writes sass:math reads as $math.name and renders the same CSS', async () => {
    const scss = '@use "sass:math";\n.a { b: math.$pi; c: #{math.$pi}; d: "x#{math.$e}"; e: math.round(math.$e); }\n';
    const jess = emitJess(parseScss(scss));
    expect(jess).toContain('b: $math.pi;');
    expect(jess).toContain('c: ~"$($math.pi)";');
    expect(jess).toContain('d: "x$($math.e)";');
    expect(jess).toContain('e: $math.round($math.e);');
    await expect(new Compiler({}).renderString(jess, { extension: '.jess' })).resolves.toBe(await renderScss(scss));
  });

  it('writes a user-module read as $ns.name and renders the same CSS', async () => {
    const scss = '@use "./vars.scss" as v;\n.a { gap: v.$gap; }\n';
    const jess = emitJess(parseScss(scss));
    expect(jess).toContain('gap: $v.gap;');
    const dir = files([['vars.scss', '$gap: 4px;\n'], ['input.scss', scss], ['input.jess', jess]]);
    await expect(render(dir, 'input.jess')).resolves.toBe(await render(dir, 'input.scss'));
  });
});
