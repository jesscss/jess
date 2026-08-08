import { describe, expect, it } from 'vitest';
import { Compiler } from '../src/index.js';

/**
 * `.jess`'s `null` literal — RESOLVED-SEMANTICS-AND-NAMING.md §4.3.
 *
 * Every expectation in the elision block is the byte-for-byte answer measured on
 * dart-sass 1.101.0 (`sass.compileString`), which is the oracle §4.3 quotes: the
 * value emits nothing AND drops the separator that would follow it, so a
 * declaration whose value is entirely `null` is DROPPED rather than emitted with
 * empty bytes.
 *
 * The comparison block is §4.1's `null` row instead — `null` grounds NUMERICALLY
 * against a number (`null` → `0`) and has no ground with anything else — which is
 * where `.jess` deliberately parts company with Sass: Sass errors on `null > 1`
 * and answers `null == 0` false, while `.jess` is total over every grounded pair.
 */
const render = async (source: string): Promise<string> =>
  new Compiler({ compile: { collapseNesting: true } })
    .renderString(source, { filePath: 'null.jess', extension: '.jess' });

describe('.jess null literal (§4.3)', () => {
  it('drops a declaration whose value is null', async () => {
    await expect(render('$x: null; a { b: $x; c: red }')).resolves.toBe('a {\n  c: red;\n}\n');
    await expect(render('a { b: null; c: red }')).resolves.toBe('a {\n  c: red;\n}\n');
  });

  it('drops a declaration whose every member elides', async () => {
    await expect(render('$x: null; a { b: $x null }')).resolves.toBe('');
  });

  it('elides from a space list, taking its separator with it', async () => {
    await expect(render('a { b: 1px null 2px }')).resolves.toBe('a {\n  b: 1px 2px;\n}\n');
    await expect(render('$x: null; a { margin: 0 $x 0 }')).resolves.toBe('a {\n  margin: 0 0;\n}\n');
  });

  it('elides from a comma list, taking its comma with it', async () => {
    await expect(render('a { b: 1px, null, 2px }')).resolves.toBe('a {\n  b: 1px, 2px;\n}\n');
  });

  it('interpolates as empty', async () => {
    await expect(render('$x: null; a { b: "v${x}" }')).resolves.toBe('a {\n  b: "v";\n}\n');
  });

  it('contributes nothing to arithmetic, from either side', async () => {
    await expect(render('a { b: $(1 + null) }')).resolves.toBe('a {\n  b: 1;\n}\n');
    await expect(render('a { b: $(null + 1) }')).resolves.toBe('a {\n  b: 1;\n}\n');
  });

  it('is not the empty string — `""` is a real value and stays', async () => {
    await expect(render('$x: ""; a { b: $x; c: red }')).resolves.toBe('a {\n  b: "";\n  c: red;\n}\n');
  });

  it('leaves an identifier that merely starts with `null` alone', async () => {
    await expect(render('a { nullish: nullish }')).resolves.toBe('a {\n  nullish: nullish;\n}\n');
  });
});

describe('.jess null comparison (§4.1 numeric ground)', () => {
  const branch = async (guard: string): Promise<string> =>
    render(`a { $if (${guard}) { b: yes } $else { b: no } }`);

  it('grounds numerically against a number', async () => {
    await expect(branch('null = 0')).resolves.toBe('a {\n  b: yes;\n}\n');
    await expect(branch('null > 1')).resolves.toBe('a {\n  b: no;\n}\n');
  });

  it('declines the coercion under the type-strict operator', async () => {
    await expect(branch('null == 0')).resolves.toBe('a {\n  b: no;\n}\n');
  });

  it('has no ground with a non-number, so equality is false rather than an error', async () => {
    await expect(branch('null = false')).resolves.toBe('a {\n  b: no;\n}\n');
  });

  it('equals itself', async () => {
    await expect(branch('null = null')).resolves.toBe('a {\n  b: yes;\n}\n');
  });

  it('is falsy (§4.4)', async () => {
    await expect(render('a { $if (null) { b: t } $else { b: f } }')).resolves.toBe('a {\n  b: f;\n}\n');
  });
});
