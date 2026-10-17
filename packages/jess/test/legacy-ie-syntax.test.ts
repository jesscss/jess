import { describe, expect, it } from 'vitest';
import type { AbstractPlugin } from '@jesscss/core';
import { CssPlugin } from '@jesscss/compiler-preset';
import lessPlugin from '@jesscss/plugin-less';
import scssPlugin from '@jesscss/plugin-scss';
import jessPlugin from '@jesscss/plugin-jess';
import { Compiler } from '../src/index.js';

/**
 * Legacy Internet Explorer syntax parses in every dialect and then fails the
 * compile with one `css/legacy-ie-syntax` error at the declaration (owner
 * 2026-10-16: *"make sure it parses successfully!"*, *"parsed fine, but then
 * errored"*, *"if the diagnostic treats it as an error, then no it doesn't
 * succeed"*). Two forms are legacy IE syntax:
 *
 * - a `progid:` declaration value, in all four dialects;
 * - a `name=value` call argument (`alpha(opacity=50)`) in `.css`, `.scss` and
 *   `.jess`. Less reads `=` in a call argument as its comparison (V11), so the
 *   form does not exist there.
 */
type Dialect = 'css' | 'less' | 'scss' | 'jess';
const DIALECTS = ['css', 'less', 'scss', 'jess'] as const;

const PLUGINS: Record<Dialect, AbstractPlugin> = {
  css: new CssPlugin(),
  less: lessPlugin(),
  scss: scssPlugin(),
  jess: jessPlugin()
};

const CODE = 'css/legacy-ie-syntax';

/** The declaration sits on line 3, column 3. */
const sheet = (value: string, prelude = ''): string => `${prelude}a {\n  color: red;\n  filter: ${value};\n}\n`;

async function compile(dialect: Dialect, source: string) {
  return new Compiler({}).renderToResult({ source, filePath: `/proj/legacy-ie.${dialect}` }, { suppressWarnings: true });
}

const PROGID = [
  'progid:DXImageTransform.Microsoft.gradient(startColorstr=\'#000\', endColorstr=\'#fff\')',
  'progid:DXImageTransform.Microsoft.Alpha(opacity = 20)',
  'progid:DX.Microsoft.Blur(pixelradius=2) progid:DX.Microsoft.Wheel(duration=3)',
  'progid:DX.Microsoft.Blur(pixelradius=2), progid:DX.Microsoft.Wheel(duration=3)',
  'PROGID:DX.Microsoft.Blur(pixelradius=2)'
];

const NAME_VALUE = [
  'alpha(opacity=50)',
  'alpha(opacity = 50)',
  'foo(b=1, c = 2)',
  'foo(x, b=1)',
  'foo(bar(x=1))',
  'foo(a /* c */ = b)',
  'gradient(startColorstr=\'#000\', endColorstr=\'#fff\')',
  'red alpha(opacity=50)',
  'red, alpha(opacity=50)',
  '(alpha(opacity=50))'
];

const NAME_VALUE_DIALECTS = ['css', 'scss', 'jess'] as const;

describe('legacy IE syntax parses', () => {
  for (const dialect of DIALECTS) {
    const cases = dialect === 'less' ? PROGID : [...PROGID, ...NAME_VALUE];
    it.each(cases)(`${dialect}: %s`, (value) => {
      const result = PLUGINS[dialect].safeParse!(`/proj/legacy-ie.${dialect}`, sheet(value));
      expect(result.errors).toEqual([]);
      expect(result.document).toBeDefined();
    });
  }
});

describe('legacy IE syntax fails the compile', () => {
  for (const dialect of DIALECTS) {
    it.each(PROGID)(`${dialect}: %s`, async (value) => {
      const result = await compile(dialect, sheet(value));
      expect(result.css).toBe('');
      expect(result.errors.map(error => [error.code, error.phase, error.line, error.column, error.message])).toEqual([
        [CODE, 'parse', 3, 3, 'Legacy IE syntax is not supported']
      ]);
      expect(result.errors[0]!.reason).toContain('progid:');
    });
  }

  for (const dialect of NAME_VALUE_DIALECTS) {
    it.each(NAME_VALUE)(`${dialect}: %s`, async (value) => {
      const result = await compile(dialect, sheet(value));
      expect(result.css).toBe('');
      expect(result.errors.map(error => [error.code, error.phase, error.line, error.column])).toEqual([[CODE, 'parse', 3, 3]]);
    });
  }

  it.each(['scss', 'jess'] as const)('%s: a variable beside the `=` is still the IE form', async (dialect) => {
    const result = await compile(dialect, sheet('alpha(opacity=$o)', '$o: 50;\n'));
    expect(result.errors.map(error => [error.code, error.line, error.column])).toEqual([[CODE, 4, 3]]);
  });

  it('names the argument it found', async () => {
    const result = await compile('css', sheet('alpha(opacity=50)'));
    expect(result.errors[0]!.reason).toContain('opacity=');
  });

  it('less: a progid declaration in a called mixin', async () => {
    const result = await compile('less', '.m(@a) {\n  filter: progid:DX.Microsoft.Alpha(opacity=@a);\n}\n.b { .m(30); }\n');
    expect(result.errors.map(error => [error.code, error.line, error.column])).toEqual([[CODE, 2, 3]]);
  });

  /* A later identical declaration replaces an earlier one in the output; the error is still the first one written. */
  for (const collapseNesting of [false, true]) {
    it.each(DIALECTS)(`%s: reports the first in source order (collapseNesting: ${collapseNesting})`, async (dialect) => {
      const source = 'a {\n  b {\n    filter: progid:DX.Microsoft.Blur(pixelradius=2);\n    filter: progid:DX.Microsoft.Blur(pixelradius=2);\n  }\n}\n';
      const result = await new Compiler({ output: { collapseNesting } }).renderToResult(
        { source, filePath: `/proj/legacy-ie.${dialect}` },
        { suppressWarnings: true }
      );
      expect(result.errors.map(error => [error.code, error.line, error.column])).toEqual([[CODE, 3, 5]]);
    });
  }

  it.each(DIALECTS)('%s: renderString rejects', async (dialect) => {
    await expect(new Compiler({}).renderString(sheet('progid:DX.Microsoft.Blur(pixelradius=2)'), {
      filePath: `/proj/legacy-ie.${dialect}`,
      config: { suppressWarnings: true }
    })).rejects.toMatchObject({ code: CODE });
  });
});

describe('what is not legacy IE syntax compiles', () => {
  async function clean(dialect: Dialect, source: string): Promise<string> {
    const result = await compile(dialect, source);
    expect(result.errors).toEqual([]);
    return result.css;
  }

  for (const dialect of DIALECTS) {
    it.each([
      ['a query range', '@media (width=600px) { a { b: c } }\n@container (width=600px) { a { b: c } }\n'],
      ['an attribute selector', '[type=text] { a: b }\na[x="="] { a: b }\n'],
      ['a custom property', 'a { --x: a=b; --y: progid:DX.Microsoft.Blur(pixelradius=2); --z: alpha(opacity=50); }\n'],
      ['a string holding `=` or `progid:`', 'a { x: foo("a=b"); y: foo("="); content: "progid:x"; }\n'],
      ['a quoted argument before `=`', 'a { x: foo("a"=b); }\n']
    ])(`${dialect}: %s`, async (_label, source) => {
      await clean(dialect, source);
    });
  }

  it('less: `=` in a call argument is the comparison', async () => {
    expect(await clean('less', 'a { x: alpha(opacity=50); y: foo(b=1, c = 2); }\n')).toBe('a {\n  x: alpha(false);\n  y: foo(false, false);\n}\n');
  });

  it('less: guards, if() and boolean() compare', async () => {
    const css = await clean('less', '.m(@a) when (@a = 1) { x: y; }\na { .m(1); b: if((1 = 1), c, d); e: boolean(3 = 4); }\n');
    expect(css).toBe('a {\n  x: y;\n  b: c;\n  e: false;\n}\n');
  });

  it('less: an escaped progid string', async () => {
    expect(await clean('less', 'a { filter: ~"progid:DX.Microsoft.Blur(pixelradius=2)"; }\n')).toBe('a {\n  filter: progid:DX.Microsoft.Blur(pixelradius=2);\n}\n');
  });

  it('scss: `==` in an argument is the comparison', async () => {
    expect(await clean('scss', 'a { x: foo(3 == 4); }\n')).toBe('a {\n  x: foo(false);\n}\n');
  });

  it('jess: a comparison inside `$( … )`', async () => {
    expect(await clean('jess', 'a { x: foo($(3 == 4)); }\n')).toBe('a {\n  x: foo(false);\n}\n');
  });

  /*
   * OPEN for the owner: each needs a decision beyond the two forms above, so
   * none is reported. Each is written as authored.
   */
  describe('not decided: written as authored, unreported', () => {
    for (const dialect of NAME_VALUE_DIALECTS) {
      it.each([
        ['a bare `=` run in a declaration', 'a { x: a=b; }\n', 'x: a=b;'],
        ['a chained `=` argument', 'a { x: foo(a=b=c); }\n', 'x: foo(a=b=c);'],
        ['an ident run before `=`', 'a { x: foo(a b=c d); }\n', 'x: foo(a b=c d);'],
        ['a run after `=`', 'a { x: foo(a=1px 2px); }\n', 'x: foo(a=1px 2px);'],
        ['expression()', 'a { width: expression(document.body.clientWidth); }\n', 'width: expression(document.body.clientWidth);']
      ].filter(([label]) => dialect !== 'scss' || label !== 'expression()'))(`${dialect}: %s`, async (_label, source, written) => {
        expect(await clean(dialect, source)).toContain(written);
      });
    }

    /* A parse gap, not this check: SCSS stops at the glued `.` run inside the call (P45). */
    it.fails('scss: expression() parses', async () => {
      await clean('scss', 'a { width: expression(document.body.clientWidth); }\n');
    });

    it.each([
      ['scss', '$v: alpha(opacity=50);\na { filter: $v; }\n', 'filter: alpha(opacity=50);'],
      ['jess', '$v: alpha(opacity=50);\na { filter: $v; }\n', 'filter: alpha(opacity=50);'],
      ['less', '@v: progid:DX.Microsoft.Blur(pixelradius=2);\na { filter: @v; }\n', 'filter: progid:DX.Microsoft.Blur(false);'],
      ['scss', '@mixin m($a) { x: $a; }\na { @include m(a=b); }\n', 'x: a = b;']
    ] as const)('%s: a variable or mixin argument holding the form: %s', async (dialect, source, written) => {
      expect(await clean(dialect, source)).toContain(written);
    });
  });
});
