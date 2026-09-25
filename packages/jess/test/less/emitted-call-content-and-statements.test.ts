import { describe, expect, it } from 'vitest';
import { emitJess } from '@jesscss/core';
import { parse as parseLess } from '@jesscss/less-parser';
import { Compiler } from '../../src/index.js';
import lessPlugin from '@jesscss/plugin-less';
import jessPlugin from '@jesscss/plugin-jess';
import { lessCompatPlugin } from '@jesscss/plugin-less-compat';

/**
 * Ledger P37: a function call that is emitted as written may not lose content,
 * and a call standing alone in statement position may only leave a statement
 * (raw text, or nothing) behind; a value dumped there is an evaluation error.
 */
const compiler = new Compiler({
  output: { collapseNesting: true },
  compile: { plugins: [lessPlugin(), jessPlugin()] }
});

const less = (source: string) => compiler.renderString(source, { language: 'less' });
const jess = (source: string) => compiler.renderString(source, { language: 'jess' });
const notAStatement = expect.objectContaining({ code: 'eval/invalid-statement' });

describe('a ruleset argument to a call emitted as written (P37, jess#290)', () => {
  it('is written from its evaluated body while the other arguments evaluate', async () => {
    await expect(less('@c: red; @l: 1 2; a { x: foo(@l, { color: @c; }); }'))
      .resolves.toBe('a {\n  x: foo(1 2, { color: red; });\n}\n');
  });

  it('binds its own variable declarations silently, as a ruleset body does', async () => {
    await expect(less('a { x: foo({ @w: 2px; width: @w * 2; margin: 0 !important; }); }'))
      .resolves.toBe('a {\n  x: foo({ width: 4px; margin: 0 !important; });\n}\n');
  });

  it('evaluates a variable bound to a ruleset in the scope it was bound in', async () => {
    await expect(less('@c: red; @d: { color: @c; }; a { @c: blue; x: foo(@d); }'))
      .resolves.toBe('a {\n  x: foo({ color: red; });\n}\n');
  });

  it('modern: an unimported each() in a value writes its evaluated ruleset', async () => {
    await expect(less('@use "#less";\n@a: 2; @l: 1 2; a { x: each(@l, { v: @a; }); }'))
      .resolves.toBe('a {\n  x: each(1 2, { v: 2; });\n}\n');
  });

  it('follows the ruleset-body rules for merge, null and ruleset values', async () => {
    await expect(less('a { x: foo({ a+: 1; a+: 2; b+_: x; b+_: y; }); }'))
      .resolves.toBe('a {\n  x: foo({ a: 1, 2; b: x y; });\n}\n');
    await expect(jess('$d: @{ a: null; b: 1; }; a { x: foo($d); y: 2; }'))
      .resolves.toBe('a {\n  x: foo({ b: 1; });\n  y: 2;\n}\n');
    await expect(less('@r: { c: d; }; a { x: foo({ a: @r; }); }'))
      .rejects.toThrow(expect.objectContaining({ code: 'eval/ruleset-on-property' }));
  });

  it('is compressed with the output', async () => {
    const compressed = new Compiler({ output: { collapseNesting: true, compress: true }, compile: { plugins: [lessPlugin()] } });
    await expect(compressed.renderString('a { x: foo({ a: 1px; b: 2 !important; }); }', { language: 'less' }))
      .resolves.toBe('a{x:foo({a:1px;b:2!important})}');
  });

  it('a ruleset holding a nested rule has no value spelling, so it raises rather than vanishing', async () => {
    await expect(less('a { x: foo({ .b { c: d; } }); }'))
      .rejects.toThrow(expect.objectContaining({ code: 'eval/ruleset-argument-with-rules' }));
  });

  it('.jess: a `@{ … }` block is written from its evaluated body, without the sigil', async () => {
    await expect(jess('$c: red; $l: 1 2; $d: @{ color: $c; }; a { x: foo($l, $d); }'))
      .resolves.toBe('a {\n  x: foo(1 2, { color: red; });\n}\n');
  });

  it('.jess: a block with params has no CSS spelling, so it raises rather than vanishing', async () => {
    await expect(jess('$f: @($x) { v: $x; }; a { x: foo($f); }'))
      .rejects.toThrow(expect.objectContaining({ code: 'eval/ruleset-argument-with-rules' }));
  });

  it('.jess: a `@{ … }` block anywhere else is unaffected', async () => {
    await expect(jess('$d: @{ color: red; }; a { $d(); }')).resolves.toBe('a {\n  color: red;\n}\n');
    await expect(jess('$d: @{ color: red; }; a { x: 1 $d; }')).resolves.toBe('a {\n  x: 1 ;\n}\n');
  });

  it('a Less ruleset anywhere else is unaffected', async () => {
    await expect(less('@d: { v: 1; }; a { x: ~"@{d}"; y: 1 @d; z: e(@d); }'))
      .resolves.toBe('a {\n  x: ;\n  y: 1 ;\n  z: ;\n}\n');
  });

  it('.less → .jess → .css equals .less → .css', async () => {
    const source = '@c: red; @d: { color: @c; }; @l: 1 2; a { x: foo(@l, @d); }';
    const direct = await less(source);
    const converted = emitJess(await parseLess(source));
    expect(direct).toBe('a {\n  x: foo(1 2, { color: red; });\n}\n');
    await expect(jess(converted)).resolves.toBe(direct);
  });
});

describe('a call standing alone in statement position (P37)', () => {
  it('emits raw text, at the root and in a declaration list', async () => {
    await expect(less('e(\'/* x */\');\na { b: c; }')).resolves.toBe('/* x */\na {\n  b: c;\n}\n');
    await expect(less('a { b: c; e(\'/* y */\'); }')).resolves.toBe('a {\n  b: c;\n  /* y */\n}\n');
  });

  it('emits nothing for a function that returns nothing', async () => {
    await expect(less('a { b: c; e(\'\'); }')).resolves.toBe('a {\n  b: c;\n}\n');
    await expect(less('e(\'\');\na { b: c; }')).resolves.toBe('a {\n  b: c;\n}\n');
  });

  it.each([
    ['a call to no function', 'foo(1);'],
    ['a function that failed and was preserved as written', 'darken(foo);'],
    ['a CSS colour call left as written', 'hsl(1 2% 3%);'],
    ['a CSS gradient call left as written', 'linear-gradient(red, blue);'],
    ['a keyword result', 'isdefined(@x);'],
    ['a dimension result', 'unit(1px, em);'],
    ['a colour result', 'rgba(0,0,0,0);']
  ])('raises for %s, at the root and in a declaration list', async (_label, statement) => {
    await expect(less(`${statement}\na { b: c; }`)).rejects.toThrow(notAStatement);
    await expect(less(`a { b: c; ${statement} }`)).rejects.toThrow(notAStatement);
  });

  it('modern: an unimported Less built-in in statement position raises', async () => {
    await expect(less('@use "#less";\n@a: 2; @l: 1 2; a { each(@l, { v: @a; }); }')).rejects.toThrow(notAStatement);
    await expect(less('@use "#less";\na { if((true), { color: red; }); }')).rejects.toThrow(notAStatement);
  });

  it('names the call, what it produced, and what to do', async () => {
    await expect(less('a { foo(1); }')).rejects.toThrow(expect.objectContaining({
      reason: expect.stringContaining('The result of "foo()", a Keyword `foo(1)`, is a value'),
      fix: expect.stringContaining('import or define the function')
    }));
  });

  /*
   * Less 4.x `tree/call.js`: a legacy `@plugin` function's `false`/`true`/falsy
   * result is empty, another non-node result is raw text, and `null`/`undefined`
   * declines, leaving the plain call.
   */
  it('converts a legacy plugin function result as Less 4.x does', async () => {
    const plugin = {
      install(api: { functions: { functionRegistry: { addMultiple(fns: Record<string, (...args: unknown[]) => unknown>): void } } }) {
        api.functions.functionRegistry.addMultiple({
          storeFalse: () => false,
          storeTrue: () => true,
          storeZero: () => 0,
          rawText: () => '/* raw */',
          declined: () => undefined
        });
      }
    };
    const withPlugin = new Compiler({
      output: { collapseNesting: true },
      compile: { plugins: [lessPlugin(), lessCompatPlugin({ plugins: [plugin] })] }
    });
    const render = (source: string) => withPlugin.renderString(source, { language: 'less' });
    await expect(render('a { b: c; storeFalse(); storeTrue(); storeZero(); }')).resolves.toBe('a {\n  b: c;\n}\n');
    await expect(render('storeFalse();\na { b: c; }')).resolves.toBe('a {\n  b: c;\n}\n');
    await expect(render('a { b: c; rawText(); }')).resolves.toBe('a {\n  b: c;\n  /* raw */\n}\n');
    await expect(render('a { x: declined(1); }')).resolves.toBe('a {\n  x: declined(1);\n}\n');
    await expect(render('a { b: c; declined(1); }')).rejects.toThrow(notAStatement);
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
