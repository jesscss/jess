import { describe, expect, it } from 'vitest';
import { Compiler } from '../../src/index.js';

/**
 * `.scss` mints the value-domain `Null` (§4.3), and Sass+ takes jess's
 * truthiness (§4.4.6).
 *
 * Every `null` expectation here is the byte-for-byte answer measured on
 * dart-sass (`sass.compileString`, a devDependency of this package): `null` is
 * the absent VALUE, so it emits nothing and takes its separator with it. Before
 * this, `.scss` spelled the literal `keyword('null')` and `null` was an
 * IDENTIFIER that happened to spell one — `b: null` emitted `b: null` and
 * `@if null` took the TRUE branch.
 *
 * The truthiness expectations are NOT dart-sass: §4.4.6 shifts `""` and `()` to
 * FALSY. What forced it was `.scss` disagreeing with itself — `or`/`and` already
 * lowered to jess's native operators, so `"" or 2` answered `2` under jess
 * truthiness while `@if ""` took the true branch under Sass's. One dialect, one
 * value, two answers, decided by which construct you wrote.
 */
const render = async (source: string): Promise<string> =>
  new Compiler().renderString(source, { extension: '.scss' });

describe('.scss null literal (§4.3)', () => {
  it('drops a declaration whose value is null', async () => {
    await expect(render('$x: null; a { b: $x; c: red }')).resolves.toBe('a {\n  c: red;\n}\n');
    await expect(render('a { b: null }')).resolves.toBe('');
  });

  it('elides from a space list, taking its separator with it', async () => {
    await expect(render('a { b: 1px null 2px }')).resolves.toBe('a {\n  b: 1px 2px;\n}\n');
    await expect(render('$x: null; a { margin: 0 $x 0 }')).resolves.toBe('a {\n  margin: 0 0;\n}\n');
  });

  it('contributes nothing to arithmetic', async () => {
    await expect(render('a { b: 1 + null }')).resolves.toBe('a {\n  b: 1;\n}\n');
  });

  it('takes the false branch of an @if', async () => {
    await expect(render('@if null { a { b: 1 } } @else { a { b: 2 } }')).resolves.toBe('a {\n  b: 2;\n}\n');
  });

  it('leaves an identifier that merely starts with `null` alone', async () => {
    await expect(render('a { b: nullish }')).resolves.toBe('a {\n  b: nullish;\n}\n');
  });

  /*
   * The literal is minted at the value-position identifier terminal ONLY. The
   * NAME positions reference `g.Keyword` directly and still read `null` as an
   * ordinary identifier, exactly as dart-sass does.
   */
  it('stays an identifier in a name position', async () => {
    await expect(render('@media null { a { b: 1 } }')).resolves.toBe('@media null {\n  a {\n    b: 1;\n  }\n}\n');
    await expect(render('@keyframes null { from { top: 0 } }')).resolves.toBe('@keyframes null {\n  from {\n    top: 0;\n  }\n}\n');
  });
});

describe('Sass+ truthiness (§4.4.6)', () => {
  const branch = async (condition: string): Promise<string> =>
    render(`@if ${condition} { a { b: T } } @else { a { b: F } }`);

  const T = 'a {\n  b: T;\n}\n';
  const F = 'a {\n  b: F;\n}\n';

  it('is falsy for exactly false, null, "" and ()', async () => {
    await expect(branch('false')).resolves.toBe(F);
    await expect(branch('null')).resolves.toBe(F);
    await expect(branch('""')).resolves.toBe(F);
    await expect(branch('()')).resolves.toBe(F);
  });

  it('is truthy for everything else, including 0 — the principle is emptiness, not zero-ness', async () => {
    await expect(branch('true')).resolves.toBe(T);
    await expect(branch('0')).resolves.toBe(T);
    await expect(branch('0px')).resolves.toBe(T);
    await expect(branch('"0"')).resolves.toBe(T);
    await expect(branch('red')).resolves.toBe(T);
  });

  /* `not $x` is simply "is $x falsy" — the same truth node under a `not`. */
  it('negates with the same rule', async () => {
    await expect(branch('not ""')).resolves.toBe(T);
    await expect(branch('not null')).resolves.toBe(T);
    await expect(branch('not false')).resolves.toBe(T);
    await expect(branch('not 0')).resolves.toBe(F);
  });

  it('answers the value-position if() the same way', async () => {
    await expect(render('a { b: if("", T, F) }')).resolves.toBe('a {\n  b: F;\n}\n');
    await expect(render('a { b: if(null, T, F) }')).resolves.toBe('a {\n  b: F;\n}\n');
    await expect(render('a { b: if(0, T, F) }')).resolves.toBe('a {\n  b: T;\n}\n');
  });

  /*
   * The contradiction §4.4.6 exists to end: `or` returns its first truthy
   * operand, and it must agree with `@if` on which operands those are.
   */
  it('agrees with the native or/and operators', async () => {
    await expect(render('a { b: "" or 2 }')).resolves.toBe('a {\n  b: 2;\n}\n');
    await expect(render('a { b: null or 2 }')).resolves.toBe('a {\n  b: 2;\n}\n');
    await expect(render('a { b: () or 2 }')).resolves.toBe('a {\n  b: 2;\n}\n');
    await expect(render('a { b: 0 or 2 }')).resolves.toBe('a {\n  b: 0;\n}\n');
    await expect(render('a { b: 1 and 2 }')).resolves.toBe('a {\n  b: 2;\n}\n');
  });
});

/** `.less` is untouched: `null` there is an ordinary identifier, emitted verbatim. */
describe('.less null is still an identifier', () => {
  it('emits the authored bytes', async () => {
    const css = await new Compiler().renderString('a { k: null; }', { extension: '.less' });
    expect(css).toBe('a {\n  k: null;\n}\n');
  });
});
