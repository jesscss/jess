/**
 * [plugin/P2] Native `@plugin` global-function loading end-to-end through the ast/
 * render — proves a Less-authored plugin's `functions.add`/`less.dimension`/
 * `new tree.Anonymous` fns resolve a call site, WITHOUT any `@jesscss/plugin-less-compat`.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { renderLessViaAst, renderLessFileViaAst, type InstallablePlugin } from '../index.js';

let dir: string;

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jess-plugin-p2-'));
  fs.writeFileSync(
    path.join(dir, 'plugin-simple.js'),
    `functions.add('pi-anon', function() { return Math.PI; });
     functions.add('pi', function() { return less.dimension(Math.PI); });`,
  );
  fs.writeFileSync(
    path.join(dir, 'plugin-global.js'),
    `functions.addMultiple({
       'test-global': function() { return new tree.Anonymous('global'); },
       'add': function(a, b) { return a.value + b.value; }
     });`,
  );
});

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('[plugin/P2] native @plugin global functions', () => {
  it('loads a `@plugin` module and resolves its raw-number fn (pi-anon)', () => {
    const src = `@plugin "./plugin-simple";\n.a { value: pi-anon(); }`;
    const res = renderLessViaAst(src, { filePath: path.join(dir, 'entry.less'), collapseNesting: true });
    expect(res.threw).toBeNull();
    expect(res.css).toContain('value: 3.141592653589793;');
  });

  it('resolves `less.dimension` and `tree.Anonymous` returns + reads numeric args', () => {
    const src = `@plugin "./plugin-simple";\n@plugin "./plugin-global";
      .a { pi: pi(); g: test-global(); sum: add(2, 3); }`;
    const res = renderLessViaAst(src, { filePath: path.join(dir, 'entry.less'), collapseNesting: true });
    expect(res.threw).toBeNull();
    // `less.dimension(Math.PI)` yields a canonicalizing Dimension (rounded),
    // distinct from a raw-number return's verbatim full precision.
    expect(res.css).toContain('pi: 3.14159265;');
    expect(res.css).toContain('g: global;');
    expect(res.css).toContain('sum: 5;');
  });

  it('drops the `@plugin` directive from output (no `@plugin …;` line)', () => {
    const src = `@plugin "./plugin-simple";\n.a { value: pi-anon(); }`;
    const res = renderLessViaAst(src, { filePath: path.join(dir, 'entry.less'), collapseNesting: true });
    expect(res.css).not.toContain('@plugin');
  });

  it('an unknown call stays verbatim (no plugin registered it)', () => {
    const src = `@plugin "./plugin-simple";\n.a { u: undefined("self"); }`;
    const res = renderLessViaAst(src, { filePath: path.join(dir, 'entry.less'), collapseNesting: true });
    expect(res.css).toContain('u: undefined("self");');
  });

  it('config-injected install plugin registers GLOBAL functions (functions-harness shape)', () => {
    interface LessArg { value: unknown }
    interface LessMock {
      functions: {
        functionRegistry: { addMultiple(fns: Record<string, (...args: LessArg[]) => unknown>): void };
      };
    }
    const harness: InstallablePlugin = {
      install(less: unknown) {
        (less as LessMock).functions.functionRegistry.addMultiple({
          _color(str: LessArg) {
            return String(str.value).replace(/^(['"])(.*)\1$/, '$2') === 'evil red' ? '#660000' : undefined;
          },
          increment(a: LessArg) {
            return (a.value as number) + 1;
          },
        });
      },
    };
    const src = `#functions { color: _color("evil red"); width: increment(15); }`;
    const res = renderLessViaAst(src, { plugins: [harness], collapseNesting: true });
    expect(res.threw).toBeNull();
    expect(res.css).toContain('color: #660000;');
    expect(res.css).toContain('width: 16;');
  });

  it('idle render (no @plugin, no config plugins) is unaffected', () => {
    const src = `.a { color: red; }`;
    const res = renderLessViaAst(src, { collapseNesting: true });
    expect(res.threw).toBeNull();
    expect(res.css).toBe('.a {\n  color: red;\n}\n');
  });

  it('renderLessFileViaAst loads a `@plugin` relative to the file', () => {
    const entry = path.join(dir, 'file-entry.less');
    fs.writeFileSync(entry, `@plugin "./plugin-simple";\n.a { value: pi-anon(); }`);
    const res = renderLessFileViaAst(entry, { collapseNesting: true });
    expect(res.threw).toBeNull();
    expect(res.css).toContain('value: 3.141592653589793;');
  });
});
