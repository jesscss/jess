/**
 * A `@plugin` function that FAILS must never fail quietly.
 *
 * Before this contract existed, a throwing plugin function was folded into the
 * generic "registered function could not produce a value" path: the call was
 * re-emitted verbatim, compilation continued, and nothing was reported — not
 * even with `suppressWarnings: false` and `breakOnError: false`. That silence
 * hid a completely broken plugin surface across an entire real-world corpus.
 *
 * The contract asserted here:
 *   a) `breakOnError: true` (the default) aborts, naming the function and throw;
 *   b) `breakOnError: false` still records an attributable warning;
 *   c) the call is never emitted verbatim with nothing said;
 *   d) the diagnostic points at the real call site, not a placeholder position.
 */
import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Compiler } from '../../src/index.js';
import lessPlugin from '@jesscss/plugin-less';
import jsPlugin from '@jesscss/plugin-js';
import { lessCompatPlugin } from '@jesscss/plugin-less-compat';

const tempDirs: string[] = [];

function makeProject(pluginSource: string, styleSource: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jess-plugin-diag-'));
  tempDirs.push(dir);
  fs.writeFileSync(path.join(dir, 'p.js'), pluginSource, 'utf8');
  const entry = path.join(dir, 'main.less');
  fs.writeFileSync(entry, styleSource, 'utf8');
  return { dir, entry };
}

function makeCompiler(dir: string) {
  return new Compiler({
    compile: {
      plugins: [
        lessPlugin(),
        jsPlugin({ jsReadRoot: dir, runtimeApi: 'less' }),
        lessCompatPlugin()
      ]
    },
    language: { less: { math: 0 } }
  });
}

const THROWING_PLUGIN = 'functions.add(\'boom\', function () { throw new Error(\'PLUGIN_EXPLODED\'); });';

describe('@plugin function failures are never silent', () => {
  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('fails loudly with breakOnError, naming the function and the throw', async () => {
    const { dir, entry } = makeProject(
      THROWING_PLUGIN,
      '@plugin "./p";\n.a {\n  width: boom(1);\n}\n'
    );
    const result = await makeCompiler(dir).renderToResult(entry, {
      suppressWarnings: true,
      breakOnError: true
    });

    expect(result.css).toBe('');
    const failure = result.errors.find(e => e.code === 'plugin/function-threw');
    expect(failure, `expected a plugin/function-threw error, got ${JSON.stringify(result.errors.map(e => e.code))}`)
      .toBeDefined();
    expect(failure!.reason).toContain('boom');
    expect(failure!.reason).toContain('PLUGIN_EXPLODED');
  }, 30000);

  it('records an attributable warning when errors are collected instead', async () => {
    const { dir, entry } = makeProject(
      THROWING_PLUGIN,
      '@plugin "./p";\n.a {\n  width: boom(1);\n}\n'
    );
    const result = await makeCompiler(dir).renderToResult(entry, {
      suppressWarnings: false,
      breakOnError: false
    });

    const warning = result.warnings.find(w => w.code === 'plugin/function-threw');
    expect(warning, `expected a plugin/function-threw warning, got ${JSON.stringify(result.warnings.map(w => w.code))}`)
      .toBeDefined();
    expect(warning!.message).toContain('boom');
    expect(warning!.reason).toContain('PLUGIN_EXPLODED');
  }, 30000);

  it('collects function-mode plugin errors without leaking an unhandled rejection', async () => {
    const { dir, entry } = makeProject(
      THROWING_PLUGIN,
      '@plugin "./p";\n.a {\n  width: boom(1);\n}\n'
    );
    const result = await new Compiler({
      compile: {
        plugins: [
          lessPlugin(),
          jsPlugin({ jsReadRoot: dir, runtimeApi: 'less' }),
          lessCompatPlugin()
        ],
        functionMode: 'error'
      },
      language: { less: { math: 0 } }
    }).renderToResult(entry, {
      suppressWarnings: true,
      breakOnError: false
    });

    const failure = result.errors.find(e => e.code === 'plugin/function-threw');
    expect(failure, `expected a plugin/function-threw error, got ${JSON.stringify(result.errors.map(e => e.code))}`)
      .toBeDefined();
    expect(failure!.reason).toContain('PLUGIN_EXPLODED');
    expect(result.warnings.find(w => w.code === 'plugin/function-threw')).toBeUndefined();
  }, 30000);

  it('never emits the failed call verbatim without saying anything', async () => {
    const { dir, entry } = makeProject(
      THROWING_PLUGIN,
      '@plugin "./p";\n.a {\n  width: boom(1);\n}\n'
    );
    const result = await makeCompiler(dir).renderToResult(entry, {
      suppressWarnings: false,
      breakOnError: false
    });

    /*
     * The call may be preserved so the rest of the sheet still compiles, but
     * preserving it silently is exactly the failure mode under test.
     */
    if (result.css.includes('boom(')) {
      expect(
        [...result.errors, ...result.warnings].some(d => d.code === 'plugin/function-threw'),
        'a preserved plugin call must be accompanied by a plugin/function-threw diagnostic'
      ).toBe(true);
    }
    expect(result.errors.length + result.warnings.length).toBeGreaterThan(0);
  }, 30000);

  it('points the diagnostic at the real call site, not a placeholder position', async () => {
    const { dir, entry } = makeProject(
      THROWING_PLUGIN,

      /* `boom(1)` sits on line 4, after the value's `width: `. */
      '@plugin "./p";\n\n.a {\n  width: boom(1);\n}\n'
    );
    const result = await makeCompiler(dir).renderToResult(entry, {
      suppressWarnings: false,
      breakOnError: false
    });

    const warning = result.warnings.find(w => w.code === 'plugin/function-threw');
    expect(warning).toBeDefined();
    expect(warning!.filePath).toBe(entry);
    expect(warning!.line).toBe(4);

    /* Not the 1:1 placeholder a position-less diagnostic would carry. */
    expect(warning!.column).toBeGreaterThan(1);
  }, 30000);

  it('surfaces a plugin that cannot be loaded at its own @plugin statement', async () => {
    const { dir, entry } = makeProject(
      'throw new Error(\'PLUGIN_LOAD_EXPLODED\');',
      '@plugin "./p";\n.a { color: red; }\n'
    );
    const result = await makeCompiler(dir).renderToResult(entry, {
      suppressWarnings: true,
      breakOnError: false
    });

    const failure = result.errors.find(e => e.code === 'plugin/load-failed');
    expect(failure, `expected plugin/load-failed, got ${JSON.stringify(result.errors.map(e => e.code))}`)
      .toBeDefined();
    expect(failure!.reason).toContain('PLUGIN_LOAD_EXPLODED');
  }, 30000);

  it('reports what a plugin says through less.logger', async () => {
    const { dir, entry } = makeProject(
      'functions.add(\'shout\', function () { less.logger.warn(\'SOMETHING_IS_WRONG\'); return new tree.Anonymous(\'ok\'); });',
      '@plugin "./p";\n.a { width: shout(); }\n'
    );
    const result = await makeCompiler(dir).renderToResult(entry, {
      suppressWarnings: false,
      breakOnError: false
    });

    const logged = result.warnings.find(w => w.code === 'plugin/log');
    expect(logged, `expected plugin/log, got ${JSON.stringify(result.warnings.map(w => w.code))}`).toBeDefined();
    expect(logged!.reason).toContain('SOMETHING_IS_WRONG');
    expect(result.css).toContain('width: ok');
  }, 30000);
});

describe('the less-compat tree shim', () => {
  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('exposes tree.Variable.prototype.find and a real this.context', async () => {
    const { dir, entry } = makeProject(
      [
        'functions.add(\'pick\', function ({ value: key }) {',
        '  const { frames, importantScope } = this.context;',
        '  if (!Array.isArray(importantScope)) { throw new Error(\'no importantScope\'); }',
        '  const map = tree.Variable.prototype.find(frames, frame => {',
        '    const { value } = frame.variable(\'@map\') || {};',
        '    return value === undefined ? undefined : value.eval(this.context);',
        '  });',
        '  for (const rule of map.ruleset.rules) {',
        '    if (rule.eval(this.context).name === key) { return rule.value; }',
        '  }',
        '  return new tree.Quoted(\'"\');',
        '});'
      ].join('\n'),
      '@plugin "./p";\n@map: { sm: 576px; lg: 992px; };\n.a { width: pick(lg); }\n'
    );
    const result = await makeCompiler(dir).renderToResult(entry, {
      suppressWarnings: false,
      breakOnError: false
    });

    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([
      expect.objectContaining({ code: 'deprecation/less-plugin' })
    ]);
    expect(result.css).toContain('width: 992px');
  }, 30000);

  it('passes a comma-list map through defaulted, positional, and named mixin parameters as a tree.Value', async () => {
    const { dir, entry } = makeProject(
      [
        'function listToMap({ value: list } = { value: [] }) {',
        '  const map = {};',
        '  list.forEach(({ value: item } = {}) => {',
        '    if (Array.isArray(item)) {',
        '      const [{ value: key }, value] = item;',
        '      map[key] = value;',
        '    }',
        '  });',
        '  return map;',
        '}',
        'functions.add(\'breakpoint-min\', function ({ value: name }, breakpoints) {',
        '  return listToMap(breakpoints)[name];',
        '});'
      ].join('\n'),
      [
        '@import "./variables";',
        '@import "./mixins";',
        '#responsive();',
        '#responsive(@explicit-breakpoints);',
        '#responsive(@breakpoints: @named-breakpoints);'
      ].join('\n')
    );
    fs.writeFileSync(path.join(dir, 'variables.less'),
      [
        '@grid-breakpoints: xs 0, sm 576px, md 768px;',
        '@explicit-breakpoints: xs 0, sm 640px, md 800px;',
        '@named-breakpoints: xs 0, sm 704px, md 896px;'
      ].join('\n'), 'utf8');
    fs.writeFileSync(path.join(dir, 'mixins.less'), [
      '@plugin "./p";',
      '#media-up(@name, @content, @breakpoints: @grid-breakpoints) {',
      '  @min: breakpoint-min(@name, @breakpoints);',
      '  .result { width: @min; }',
      '}',
      '#responsive(@breakpoints: @grid-breakpoints) {',
      '  #media-up(sm, { color: red; }, @breakpoints);',
      '  #media-up(md, { color: blue; }, @breakpoints);',
      '}'
    ].join('\n'), 'utf8');
    for (const collapseNesting of [false, true]) {
      const result = await makeCompiler(dir).renderToResult(entry, {
        suppressWarnings: true,
        breakOnError: false,
        output: { collapseNesting }
      });

      expect(result.errors).toEqual([]);
      expect(result.warnings.find(w => w.code === 'plugin/function-threw')).toBeUndefined();
      expect(result.css).toContain('width: 576px');
      expect(result.css).toContain('width: 768px');
      expect(result.css).toContain('width: 640px');
      expect(result.css).toContain('width: 800px');
      expect(result.css).toContain('width: 704px');
      expect(result.css).toContain('width: 896px');
      expect(result.css).not.toContain('breakpoint-min(');
    }
  }, 30000);

  it('retains a defaulted comma-list map for the first plugin declared inside the selected mixin', async () => {
    const { dir, entry } = makeProject(
      [
        'functions.add(\'breakpoint-min\', function ({ value: name }, { value: list }) {',
        '  for (const { value: item } of list) {',
        '    if (item[0].value === name) { return item[1]; }',
        '  }',
        '});'
      ].join('\n'),
      [
        '@grid-breakpoints: xs 0, sm 576px;',
        '@first-breakpoints: xs 0, sm 640px;',
        '@final-breakpoints: xs 0, sm 704px;',
        '@pattern-breakpoints: xs 0, sm 896px;',
        '@multi-breakpoints: xs 0, sm 1024px;',
        '.media-up(@breakpoints: @grid-breakpoints) {',
        '  @plugin "./p";',
        '  .result { width: breakpoint-min(sm, @breakpoints); }',
        '}',
        '.media-up();',
        '.media-up(@breakpoints: @first-breakpoints, @breakpoints: @final-breakpoints);',
        '.pattern(red, @breakpoints) {',
        '  @plugin "./p";',
        '  .pattern-result { width: breakpoint-min(sm, @breakpoints); }',
        '}',
        '.pattern(red, @pattern-breakpoints);',
        '.multi(@breakpoints) {',
        '  @plugin "./p";',
        '  .multi-one { width: breakpoint-min(sm, @breakpoints); }',
        '}',
        '.multi(@breakpoints) {',
        '  @plugin "./p";',
        '  .multi-two { width: breakpoint-min(sm, @breakpoints); }',
        '}',
        '.multi(@multi-breakpoints);'
      ].join('\n')
    );
    for (const collapseNesting of [false, true]) {
      const result = await makeCompiler(dir).renderToResult(entry, {
        suppressWarnings: true,
        breakOnError: false,
        output: { collapseNesting }
      });

      expect(result.errors).toEqual([]);
      expect(result.warnings.find(w => w.code === 'plugin/function-threw')).toBeUndefined();
      expect(result.css).toContain('width: 576px');
      expect(result.css).toContain('width: 704px');
      expect(result.css).toContain('width: 896px');
      expect(result.css.match(/width: 1024px/g)).toHaveLength(2);
      expect(result.css).not.toContain('width: 640px');
      expect(result.css).not.toContain('breakpoint-min(');
    }
  }, 30000);

  it('keeps typed list semantics and authored bytes independent of an unrelated plugin', async () => {
    const pluginSource = 'functions.add("noop", function () { return new tree.Anonymous("ok"); });';
    const body = [
      '@layout-map: alpha,',
      '  beta;',
      '@space-list: 1 2 3;',
      '@comma-list: 1, 2, 3;',
      '#ordered(@left; @right) when (@left < @right) {',
      '  .guard-order { result: preserved; }',
      '}',
      '#layout(@value) {',
      '  .layout {',
      '    value: @value;',
      '    length: length(@value);',
      '    second: extract(@value, 2);',
      '  }',
      '}',
      '#ordered(@space-list; @comma-list);',
      '#layout(@layout-map);'
    ].join('\n');
    const plain = makeProject(pluginSource, body);
    const withPlugin = makeProject(pluginSource, `@plugin "./p";\n${body}`);

    for (const collapseNesting of [false, true]) {
      const options = {
        suppressWarnings: true,
        output: { collapseNesting }
      };
      const control = await makeCompiler(plain.dir).renderToResult(plain.entry, options);
      const candidate = await makeCompiler(withPlugin.dir).renderToResult(withPlugin.entry, options);

      expect(candidate.errors).toEqual([]);
      expect(candidate.css).toBe(control.css);
      expect(candidate.css).toContain('result: preserved');
      expect(candidate.css).toContain('value: alpha,\n    beta');
      expect(candidate.css).toContain('length: 2');
      expect(candidate.css).toContain('second: beta');
    }
  }, 30000);

  it('refuses an unsupported tree member with an attributable error', async () => {
    const { dir, entry } = makeProject(
      'functions.add(\'nope\', function () { return new tree.Media(); });',
      '@plugin "./p";\n.a { width: nope(); }\n'
    );
    const result = await makeCompiler(dir).renderToResult(entry, {
      suppressWarnings: true,
      breakOnError: false
    });

    const warning = result.warnings.find(w => w.code === 'plugin/function-threw');
    expect(warning).toBeDefined();
    expect(warning!.reason).toContain('tree.Media');
    expect(warning!.reason).toContain('not supported');
  }, 30000);

  it('registers @plugin functions declared in an imported file', async () => {
    const { dir, entry } = makeProject(
      'functions.add(\'answer\', function () { return new tree.Dimension(42, \'px\'); });',
      '@import "./_fns";\n.a { width: answer(); }\n'
    );
    fs.writeFileSync(path.join(dir, '_fns.less'), '@plugin "./p";\n', 'utf8');

    const result = await makeCompiler(dir).renderToResult(entry, {
      suppressWarnings: false,
      breakOnError: false
    });

    expect(result.errors).toEqual([]);
    expect(result.css).toContain('width: 42px');
  }, 30000);
});
