import { describe, expect, it } from 'vitest';
import { Compiler } from '../../src/index.js';
import lessPlugin from '@jesscss/plugin-less';
import jessPlugin from '@jesscss/plugin-jess';

/**
 * Ledger P37: a function call that is emitted as written may not lose content,
 * and one standing alone in statement position is an evaluation error.
 */
const compiler = new Compiler({
  output: { collapseNesting: true },
  compile: { plugins: [lessPlugin(), jessPlugin()] }
});

const less = (source: string) => compiler.renderString(source, { language: 'less' });
const jess = (source: string) => compiler.renderString(source, { language: 'jess' });
const unresolvedStatement = expect.objectContaining({ code: 'eval/unresolved-call-statement' });

describe('a ruleset argument to a call emitted as written (P37, jess#290)', () => {
  it('is written as authored while the other arguments evaluate', async () => {
    await expect(less('@l: 1 2; a { x: foo(@l, { v: 1; }); }'))
      .resolves.toBe('a {\n  x: foo(1 2, { v: 1; });\n}\n');
  });

  it('keeps the authored spacing of the block', async () => {
    await expect(less('a { x: foo({  v: 1;  w: @nope; }, b); }'))
      .resolves.toBe('a {\n  x: foo({  v: 1;  w: @nope; }, b);\n}\n');
  });

  it('modern: an unimported each() in a value writes its ruleset as authored', async () => {
    await expect(less('@use "#less";\n@l: 1 2; a { x: each(@l, { v: 1; }); }'))
      .resolves.toBe('a {\n  x: each(1 2, { v: 1; });\n}\n');
  });

  it('writes a variable bound to a ruleset as that ruleset', async () => {
    await expect(less('@d: { v: 1; }; a { x: foo(@d); }'))
      .resolves.toBe('a {\n  x: foo({ v: 1; });\n}\n');
  });

  it('.jess: a `@{ … }` block is written as its authored `{ … }`, without the sigil', async () => {
    await expect(jess('$l: 1 2; $d: @{  v: 1; }; a { x: foo($l, $d); }'))
      .resolves.toBe('a {\n  x: foo(1 2, {  v: 1; });\n}\n');
  });

  it('.jess: a block with params has no CSS spelling, so it raises rather than vanishing', async () => {
    await expect(jess('$f: @($x) { v: $x; }; a { x: foo($f); }'))
      .rejects.toThrow(expect.objectContaining({ code: 'eval/ruleset-without-spelling' }));
  });

  it('.jess: a `@{ … }` block anywhere else is unaffected', async () => {
    await expect(jess('$d: @{ color: red; }; a { $d(); }')).resolves.toBe('a {\n  color: red;\n}\n');
    await expect(jess('$d: @{ color: red; }; a { x: 1 $d; }')).resolves.toBe('a {\n  x: 1 ;\n}\n');
  });

  it('a Less ruleset anywhere else is unaffected', async () => {
    await expect(less('@d: { v: 1; }; a { x: ~"@{d}"; y: 1 @d; z: e(@d); }'))
      .resolves.toBe('a {\n  x: ;\n  y: 1 ;\n  z: ;\n}\n');
  });
});

describe('a bare call in statement position (P37)', () => {
  it('raises at the stylesheet root', async () => {
    await expect(less('foo(1);\na { b: c; }')).rejects.toThrow(unresolvedStatement);
  });

  it('raises in a declaration list', async () => {
    await expect(less('a { b: c; foo(1); }')).rejects.toThrow(unresolvedStatement);
  });

  it('modern: raises at the root and in a declaration list', async () => {
    await expect(less('@use "#less";\nfoo(1);\na { b: c; }')).rejects.toThrow(unresolvedStatement);
    await expect(less('@use "#less";\na { b: c; foo(1); }')).rejects.toThrow(unresolvedStatement);
  });

  it('modern: an unimported Less built-in in statement position raises', async () => {
    await expect(less('@use "#less";\n@l: 1 2; a { each(@l, { v: @value; }); }')).rejects.toThrow(unresolvedStatement);
    await expect(less('@use "#less";\na { if((true), { color: red; }); }')).rejects.toThrow(unresolvedStatement);
  });

  it('names the call and says what to do', async () => {
    await expect(less('a { foo(1); }')).rejects.toThrow(expect.objectContaining({
      reason: expect.stringContaining('"foo()"'),
      fix: expect.stringContaining('Import or define "foo"')
    }));
  });

  it('still evaluates a call that reaches a function', async () => {
    await expect(less('e(\'/* x */\');\na { b: c; }')).resolves.toBe('/* x */\na {\n  b: c;\n}\n');
  });

  it('.jess: a bare call does not parse in statement position', async () => {
    await expect(jess('foo(1);\na { b: c; }')).rejects.toThrow(expect.objectContaining({ code: 'parse/syntax-error' }));
    await expect(jess('a { b: c; foo(1); }')).rejects.toThrow(expect.objectContaining({ code: 'parse/syntax-error' }));
  });
});

describe('legacy Less lowers statement-position each() and if() (P37, jess#285)', () => {
  it('each() at statement level still loops', async () => {
    await expect(less('@l: 1 2; a { each(@l, { v-@{value}: @value; }); }'))
      .resolves.toBe('a {\n  v-1: 1;\n  v-2: 2;\n}\n');
  });

  it('if() in a declaration list emits its taken branch', async () => {
    await expect(less('a { if((true), { color: red; }); }')).resolves.toBe('a {\n  color: red;\n}\n');
    await expect(less('a { if((false), { color: red; }, { color: blue; }); }')).resolves.toBe('a {\n  color: blue;\n}\n');
  });

  it('if() at the stylesheet root emits its taken branch', async () => {
    await expect(less('if((true), { a { color: red; } });')).resolves.toBe('a {\n  color: red;\n}\n');
  });

  it('an untaken if() with no else emits nothing', async () => {
    await expect(less('a { b: c; if((false), { g: 7; }); }')).resolves.toBe('a {\n  b: c;\n}\n');
  });
});
