import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import lessPlugin from '@jesscss/plugin-less';
import { describe, expect, it } from 'vitest';
import { Compiler } from '../src/index.js';

const lines = (count: number) => '/* a line */\n'.repeat(count);

const files: ReadonlyArray<readonly [name: string, source: string]> = [
  ['_l.less', `${lines(4)}.m() { @r: (1 / 0); }\n.o() { @r: @nope; }\n.p() { v: (1 / 0); }\n`],
  ['_r.scss', `${lines(4)}@function f($x) {\n  @return $x/2 == 2;\n}\n`],
  ['_o.scss', `${lines(4)}@use "r";\n@function viaIf($x) {\n  @if r.f($x) == a {\n    @return 1;\n  }\n  @return 2;\n}\n@function viaEach($x) {\n  @each $i in r.f($x) {\n    $x: $i;\n  }\n  @return 2;\n}\n@function viaLocal($x) {\n  $y: r.f($x);\n  @return $y;\n}\n@function viaReturn($x) {\n  @return r.f($x);\n}\n@function ownIf($x) {\n  @if $x/2 == 2 {\n    @return 1;\n  }\n  @return 2;\n}\n@function ownLocal($x) {\n  $y: $x/2 == 2;\n  @return $y;\n}\n`],
  ['_mx.scss', `${lines(4)}@use "r";\n@mixin calls($x) {\n  a: r.f($x);\n}\n`]
];

/**
 * A span means something only in the file that wrote it. A value is often read
 * from another file than the one the render is in: a function's `@return` on its
 * caller's lane, a mixin's value through a lookup. The diagnostic still names the
 * file that wrote the node, at the line it is on there.
 */
describe('a diagnostic names the file that wrote what raised it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'jess-diagnostic-file-'));
  for (const [name, source] of files) {
    writeFileSync(join(dir, name), source);
  }
  const raises = (entry: string, source: string) => {
    writeFileSync(join(dir, entry), source);
    const plugins = entry.endsWith('.less') ? [lessPlugin()] : undefined;
    return expect(new Compiler({ compile: { plugins } }).render(join(dir, entry))).rejects;
  };

  it.each([
    ['a lookup into a mixin call', '@import "_l";\na { b: .m()[@r]; }\n', 'eval/division-by-zero', '_l.less', 5, 15],
    ['a lookup into a mixin held in a variable', '@import "_l";\n@p: .m();\na { b: @p[@r]; }\n', 'eval/division-by-zero', '_l.less', 5, 15],
    ['a mixin call', '@import "_l";\na { .m(); }\n', 'eval/division-by-zero', '_l.less', 5, 15],
    ['a name a looked-up mixin cannot find', '@import "_l";\na { b: .o()[@r]; }\n', 'resolve/name-not-found', '_l.less', 6, 12],
    ['the file itself', 'a { b: (1 / 0); }\n', 'eval/division-by-zero', 'own.less', 1, 11]
  ])('in Less: %s', async (label, source, code, file, line, column) => {
    await raises(file === 'own.less' ? file : `${label.replace(/\W+/g, '-')}.less`, source).toMatchObject({ code, line, column, filePath: join(dir, file) });
  });

  it.each([
    ['a `@return` through `@use`', '@use "r";\nc { d: r.f(4) }\n', '_r.scss', 6, 16],
    ['a `@return` through `@import`', '@import "r";\nc { d: f(4) }\n', '_r.scss', 6, 16],
    ['a `@return` read in the `@if` of a function in another file', '@use "o";\nc { d: o.viaIf(4) }\n', '_r.scss', 6, 16],
    ['a `@return` read in the `@each` of a function in another file', '@use "o";\nc { d: o.viaEach(4) }\n', '_r.scss', 6, 16],
    ['a `@return` read into a local in another file', '@use "o";\nc { d: o.viaLocal(4) }\n', '_r.scss', 6, 16],
    ['a `@return` of a `@return` in another file', '@use "o";\nc { d: o.viaReturn(4) }\n', '_r.scss', 6, 16],
    ['an `@if` in a function in another file', '@use "o";\nc { d: o.ownIf(4) }\n', '_o.scss', 26, 9],
    ['a local that raises when read', '@use "o";\nc { d: o.ownLocal(4) }\n', '_o.scss', 32, 12],
    ['a mixin in another file calling the function', '@import "mx";\nc { @include calls(4); }\n', '_r.scss', 6, 16]
  ])('in SCSS: %s', async (label, source, file, line, column) => {
    await raises(`${label.replace(/\W+/g, '-')}.scss`, source).toMatchObject({ code: 'eval/incomparable-operands', line, column, filePath: join(dir, file) });
  });
});
