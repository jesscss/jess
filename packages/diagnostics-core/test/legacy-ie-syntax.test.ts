import { describe, expect, it } from 'vitest';
import { collectTolerantDiagnostics } from '../src/index.js';

/**
 * The editor twin of the compiler's legacy IE syntax error (owner 2026-10-16):
 * the same code, severity, message, reason, fix and location — the declaration
 * — as `packages/jess/test/legacy-ie-syntax.test.ts` asserts for the compile.
 */
type Dialect = 'css' | 'less' | 'scss' | 'jess';
const DIALECTS = ['css', 'less', 'scss', 'jess'] as const;
const NAME_VALUE_DIALECTS = ['css', 'scss', 'jess'] as const;

const sheet = (value: string, prelude = ''): string => `${prelude}a {\n  color: red;\n  filter: ${value};\n}\n`;

function legacyIe(dialect: Dialect, source: string) {
  return collectTolerantDiagnostics({ source, language: dialect }).diagnostics
    .filter(diagnostic => diagnostic.code === 'css/legacy-ie-syntax')
    .map(({ phase, defaultSeverity, message, reason, fix, line, column }) => ({ phase, defaultSeverity, message, reason, fix, line, column }));
}

const PROGID = {
  phase: 'parse',
  defaultSeverity: 'error',
  message: 'Legacy IE syntax is not supported',
  reason: '`progid:` is legacy Internet Explorer syntax, which no other browser reads.',
  fix: 'Remove the declaration, or write what the filter did in standard CSS (opacity, a linear-gradient() background, or the filter property\'s functions).',
  line: 3,
  column: 3
};

const nameValue = (name: string, line = 3) => ({
  ...PROGID,
  reason: `\`${name}=\` is legacy Internet Explorer syntax, which no other browser reads.`,
  fix: 'Remove the argument, or write what it did in standard CSS (alpha(opacity=50) is opacity: 0.5).',
  line
});

describe('a progid value', () => {
  for (const dialect of DIALECTS) {
    it.each([
      'progid:DXImageTransform.Microsoft.gradient(startColorstr=\'#000\', endColorstr=\'#fff\')',
      'progid:DXImageTransform.Microsoft.Alpha(opacity = 20)',
      'progid:DX.Microsoft.Blur(pixelradius=2) progid:DX.Microsoft.Wheel(duration=3)',
      'progid:DX.Microsoft.Blur(pixelradius=2), progid:DX.Microsoft.Wheel(duration=3)',
      'PROGID:DX.Microsoft.Blur(pixelradius=2)'
    ])(`${dialect}: %s`, (value) => {
      expect(legacyIe(dialect, sheet(value))).toEqual([PROGID]);
    });
  }
});

describe('a name=value argument', () => {
  for (const dialect of NAME_VALUE_DIALECTS) {
    it.each([
      ['alpha(opacity=50)', 'opacity'],
      ['alpha(opacity = 50)', 'opacity'],
      ['foo(b=1, c = 2)', 'b'],
      ['foo(x, b=1)', 'b'],
      ['foo(bar(x=1))', 'x'],
      ['foo(a /* c */ = b)', 'a'],
      ['gradient(startColorstr=\'#000\', endColorstr=\'#fff\')', 'startColorstr'],
      ['red alpha(opacity=50)', 'opacity'],
      ['red, alpha(opacity=50)', 'opacity'],
      ['(alpha(opacity=50))', 'opacity']
    ])(`${dialect}: %s`, (value, name) => {
      expect(legacyIe(dialect, sheet(value))).toEqual([nameValue(name)]);
    });

    it(`${dialect}: a variable beside the \`=\``, () => {
      const prelude = dialect === 'css' ? '' : '$o: 50;\n';
      expect(legacyIe(dialect, sheet('alpha(opacity=$o)', prelude))).toEqual(dialect === 'css' ? [] : [nameValue('opacity', 4)]);
    });
  }

  it('less: `=` in a call argument is the comparison', () => {
    expect(legacyIe('less', sheet('alpha(opacity=50)'))).toEqual([]);
    expect(legacyIe('less', sheet('foo(b=1, c = 2)'))).toEqual([]);
  });
});

describe('what is not legacy IE syntax is not reported', () => {
  for (const dialect of DIALECTS) {
    it.each([
      '@media (width=600px) { a { b: c } }\n@container (width=600px) { a { b: c } }\n',
      '[type=text] { a: b }\na[x="="] { a: b }\n',
      'a { --x: a=b; --y: progid:DX.Microsoft.Blur(pixelradius=2); --z: alpha(opacity=50); }\n',
      'a { x: foo("a=b"); y: foo("="); content: "progid:x"; }\n'
    ])(`${dialect}: %s`, (source) => {
      expect(legacyIe(dialect, source)).toEqual([]);
    });
  }

  /* A `=` delim outside the two forms is invalid punctuation instead (ledger P48). */
  for (const dialect of NAME_VALUE_DIALECTS) {
    it.each([
      'a { x: a=b; }\n',
      'a { x: foo(a=b=c); }\n',
      'a { x: foo(a b=c d); }\n',
      'a { x: foo(a=1px 2px); }\n',
      'a { x: foo("a"=b); }\n'
    ])(`${dialect}: invalid punctuation, not legacy IE syntax: %s`, (source) => {
      expect(legacyIe(dialect, source)).toEqual([]);
      expect(collectTolerantDiagnostics({ source, language: dialect }).diagnostics.map(diagnostic => diagnostic.code))
        .toContain('css/invalid-value-punctuation');
    });
  }

  it.each([
    ['less', 'a { filter: ~"progid:DX.Microsoft.Blur(pixelradius=2)"; }\n'],
    ['less', '.m(@a) when (@a = 1) { x: y; }\na { b: if((1 = 1), c, d); e: boolean(3 = 4); }\n'],
    ['scss', '@mixin m($a) { x: $a; }\na { @include m(a=b); }\n'],
    ['scss', '@function f($a) { @return $a; }\na { x: f($a: b=c); }\n']
  ] as const)('%s: %s', (dialect, source) => {
    expect(legacyIe(dialect, source)).toEqual([]);
  });

  /*
   * The compiler reports these at the declaration that writes the value (ledger
   * P47 notes); the language service does not evaluate references, so a form
   * that reaches a declaration only through one is not reported here.
   */
  it.each([
    ['scss', '$v: alpha(opacity=50);\na { filter: $v; }\n'],
    ['jess', '$v: alpha(opacity=50);\na { filter: $v; }\n'],
    ['less', '@v: progid:DX.Microsoft.Blur(pixelradius=2);\na { filter: @v; }\n']
  ] as const)('%s: through a reference, not evaluated: %s', (dialect, source) => {
    expect(legacyIe(dialect, source)).toEqual([]);
  });
});
