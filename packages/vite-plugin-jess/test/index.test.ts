import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { build, createServer } from 'vite';
import jess from '../src/index.js';

type Runtime = { css: string; vars: (values: Record<string, string>) => Record<string, string> };

type Module = Runtime & { classes: Record<string, string>; card: string };

/** The bundled module of a `.module.less`, once it is known to export its classes. */
function isModule(module: unknown): module is Module {
  return isRuntime(module) && 'classes' in module && typeof module.classes === 'object' && 'card' in module;
}

/** The bundled module, once it is known to export the runtime. */
function isRuntime(module: unknown): module is Runtime {
  return typeof module === 'object' && module !== null && 'vars' in module && typeof module.vars === 'function';
}

describe('vite-plugin-jess', () => {
  it('bundles the CSS and the runtime of a stylesheet that exposes variables', async () => {
    const result = await build({
      root: __dirname,
      configFile: false,
      logLevel: 'silent',
      plugins: [jess()],
      build: { write: false, lib: { entry: path.resolve(__dirname, 'main.js'), formats: ['es'], fileName: 'main' } }
    });
    const first = [result].flat()[0];
    const output = first !== undefined && 'output' in first ? first.output : [];
    const css = output.find(item => item.type === 'asset' && item.fileName.endsWith('.css'));
    expect(css?.type === 'asset' ? String(css.source) : '').toContain('var(--brand-lightness,');

    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vite-plugin-jess-'));
    try {
      const file = path.join(directory, 'main.mjs');
      fs.writeFileSync(file, output[0]?.code ?? '');
      const module: unknown = await import(file);
      expect(isRuntime(module)).toBe(true);
      if (isRuntime(module)) {
        expect(module.css).toContain('var(--brand,');
        // eslint-disable-next-line @typescript-eslint/naming-convention -- custom property names
        expect(module.vars({ brand: '#08f' })).toEqual({ '--brand': '#08f', '--brand-lightness': '50%' });
      }
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  /** A throwaway project: `files` written to a directory under the OS temp dir, passed to `run`, then removed. */
  async function inProject(files: ReadonlyArray<readonly [string, string]>, run: (root: string) => Promise<void>): Promise<void> {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'vite-plugin-jess-')));
    try {
      for (const [name, text] of files) {
        fs.writeFileSync(path.join(root, name), text);
      }
      await run(root);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }

  /** The CSS and JS of a build of `main.js` in `root`. */
  async function built(root: string, options: Parameters<typeof jess>[0] = {}): Promise<{ css: string; js: string }> {
    const result = await build({
      root,
      configFile: false,
      logLevel: 'silent',
      plugins: [jess(options)],
      build: { write: false, lib: { entry: path.join(root, 'main.js'), formats: ['es'], fileName: 'main' } }
    });
    const first = [result].flat()[0];
    const output = first !== undefined && 'output' in first ? first.output : [];
    const css = output.find(item => item.type === 'asset' && item.fileName.endsWith('.css'));
    return { css: css?.type === 'asset' ? String(css.source) : '', js: output[0]?.code ?? '' };
  }

  it('bundles a function with a CSS form that the runtime has to run', async () => {
    await inProject([
      ['main.js', `export { vars } from './theme.less';\n`],
      ['theme.less', `@use "#less";\n@expose brand;\n@brand: #c00;\n.a { line-height: @less.lightness(@less.spin(@brand, 30)); }\n`]
    ], async (root) => {
      const { js } = await built(root);
      const file = path.join(root, 'main.mjs');
      fs.writeFileSync(file, js);
      const module: unknown = await import(file);
      expect(isRuntime(module) && module.vars({ brand: '#08f' })['--brand-lightness']).toBe('50%');
    });
  });

  it('bundles a function with no CSS form without the evaluator a form runs on', async () => {
    await inProject([
      ['main.js', `export { vars } from './theme.less';\n`],
      ['theme.less', `@use "#less";\n@expose brand;\n@brand: #c00;\n.a { opacity: @less.lightness(@brand); }\n`]
    ], async (root) => {
      const { js } = await built(root);

      /* ponytail: a size ceiling is the cheap check that no form reached it; with the evaluator it is over 500 KB. Each ceiling is its measured size plus about 5% and is only ever lowered (docs/perf/BENCHMARKS.md §10). 7,445 B measured (3,049 B gzip), with one binder loop over per-parameter checks; 8,387 B with a spelled colour built without the colour writer; 11,115 B with the hex-only reader; 14,571 B with the value text reader; 14,514 B measured (5,281 B gzip), with patch-css minified; 14,737 B before; 15,717 B with the unit check and unit tables; 19,126 B with the binder's general check, and no colour-name table (R8-13); 22,359 B when it came with every value reader and the binder, 31,736 B before functions had one calling convention, 43,976 B when every node constructor and the color-name object came with it. */
      expect(js.length).toBeLessThan(7_820);
      expect(js).not.toContain('computes from CSS literals');
      expect(js).not.toContain('is read by a CSS form');
      expect(js).not.toContain('dvmin');
    });
  });

  it.each([
    ['@less.mix(@brand, red, 25%)', 'color-mix(in srgb,var(--brand, #c00) 25%,red)'],
    ['@less.contrast(@brand)', 'contrast-color(var(--brand, #c00))']
  ])('bundles no evaluator for %s', async (call, printed) => {
    await inProject([
      ['main.js', `export { vars } from './theme.less';\n`],
      ['theme.less', `@use "#less";\n@expose brand;\n@brand: #c00;\n.a { color: ${call}; }\n`]
    ], async (root) => {
      const { css, js } = await built(root);
      expect(css).toContain(printed);

      /* Only `@jesscss/patch-css`'s key map, as nothing is computed and no CSS form reads the export (Vite's built module, unminified): 381 B measured for each (300 B minified, 234 B gzip), 2,195 B when it carried the unit check and the number formatter. */
      expect(js.length).toBeLessThan(400);
    });
  });

  /* Owner ruling 2026-11-12 ("Yes, gate it"): a colour name reaches a computed value only when the stylesheet's own value is a name or the page opts in (R8 spec, colour names). */
  it.each([
    ['#c00', {}, false],
    ['#c00', { colorNames: true }, true],
    ['red', {}, true],
    ['rgb(0 0 255)', {}, false]
  ] as const)('takes a colour name for @brand: %s with %o only when names are on', async (own, options, names) => {
    await inProject([
      ['main.js', `export { vars } from './theme.less';\n`],
      ['theme.less', `@use "#less";\n@expose brand;\n@brand: ${own};\n.a { opacity: @less.lightness(@brand); }\n`]
    ], async (root) => {
      const { js } = await built(root, options);
      const file = path.join(root, 'main.mjs');
      fs.writeFileSync(file, js);
      const module: unknown = await import(file);
      expect(isRuntime(module) && module.vars({ brand: '#08f' })['--brand-lightness']).toBe('50%');
      const named = (): unknown => isRuntime(module) && module.vars({ brand: 'blue' })['--brand-lightness'];
      if (names) {
        expect(named()).toBe('50%');
      } else {
        expect(named).toThrow(new TypeError('`brand` received `blue`, which is not a hex colour; set `colorNames: true` in the Jess plugin options to accept colour names.'));

        /* Function text is refused, with no advice to take names, which would not help. */
        expect(() => isRuntime(module) && module.vars({ brand: 'rgb(0 0 255)' })).toThrow(/^(?!.*colorNames).*rgb\(0 0 255\)/);
      }
    });
  });

  /* A colour name the recipe itself writes is read at compile time (R8 spec, colour names), so it brings no name table. */
  it('bundles no colour-name table for a name a recipe argument writes', async () => {
    await inProject([
      ['main.js', `export { vars } from './theme.less';\n`],
      ['theme.less', `@use "#less";\n@expose brand;\n@brand: #c00;\n.a { v: @less.lightness(@less.multiply(@brand, gray)); }\n`]
    ], async (root) => {
      const { js } = await built(root, {});
      expect(js).not.toContain('aliceblue');
      const file = path.join(root, 'main.mjs');
      fs.writeFileSync(file, js);
      const module: unknown = await import(file);
      expect(isRuntime(module) && module.vars({ brand: '#08f' })['--brand-lightness']).toBe('25.098039216%');
    });
  });

  /* A colour export passed through extract() takes the hex check too (owner, 2026-11-13: "I agree with the reco"). */
  it('rejects a colour name for an export passed through extract(), and bundles no name table', async () => {
    await inProject([
      ['main.js', `export { vars } from './theme.less';\n`],
      ['theme.less', `@use "#less";\n@expose brand, l;\n@brand: #c00;\n@l: #f00 #00f;\n.a { v: @less.lightness(@less.multiply(@brand, #888)); w: @less.luma(@less.extract(@l, 1)); }\n`]
    ], async (root) => {
      const { js } = await built(root, {});
      expect(js).not.toContain('aliceblue');
      const file = path.join(root, 'main.mjs');
      fs.writeFileSync(file, js);
      const module: unknown = await import(file);
      expect(() => isRuntime(module) && module.vars({ brand: 'blue' })).toThrow('`brand` received `blue`, which is not a hex colour');
      expect(() => isRuntime(module) && module.vars({ l: 'red #00f' })).toThrow('`l` received `red #00f`, which is not a hex colour; set `colorNames: true` in the Jess plugin options to accept colour names.');
      expect(isRuntime(module) && module.vars({ l: '#000 #00f' })['--l-luma']).toBe('0%');
    });
  });

  /* A colour export passed through another function may be a list, so the page keeps the text reader. */
  it('reads a list given for a colour export a recipe passes through another function', async () => {
    await inProject([
      ['main.js', `export { vars } from './theme.less';\n`],
      ['theme.less', `@use "#less";\n@expose list;\n@list: #c00;\n.a { opacity: @less.luma(@less.extract(@list, @less.length(@list))); }\n`]
    ], async (root) => {
      const { js } = await built(root, {});
      const file = path.join(root, 'main.mjs');
      fs.writeFileSync(file, js);
      const module: unknown = await import(file);
      expect(isRuntime(module) && module.vars({ list: '#f00 #00f' })['--list-luma']).toBe('7.22%');
      expect(isRuntime(module) && module.vars({ list: '#f00, #00f' })['--list-luma']).toBe('7.22%');
      expect(() => isRuntime(module) && module.vars({ list: '#f00 blue' })).toThrow('`list` received `#f00 blue`, which is not a hex colour');
    });
  });

  it('rejects a colour name in any item of a hex-checked export, though the page reads its own names', async () => {
    await inProject([
      ['main.js', `export { vars } from './theme.less';\n`],
      ['theme.less', `@use "#less";\n@expose b;\n@b: #f00 #00f;\n.a { v: @less.luma(@less.extract(@b, 2)); w: @less.isunit(@b, red); }\n`]
    ], async (root) => {
      const { js } = await built(root, {});
      const file = path.join(root, 'main.mjs');
      fs.writeFileSync(file, js);
      const module: unknown = await import(file);
      for (const given of ['#00f red', '#00f, red', 'blue,#00f']) {
        expect(() => isRuntime(module) && module.vars({ b: given })).toThrow(`\`b\` received \`${given}\`, which is not a hex colour`);
      }
      expect(isRuntime(module) && module.vars({ b: '#fff #000' })['--b-luma']).toBe('0%');
    });
  });

  it('holds a percentage a computed value reads as its ratio, and checks its unit', async () => {
    await inProject([
      ['main.js', `export { vars } from './theme.less';\n`],
      ['theme.less', `@use "#less";\n@expose a;\n@a: 50%;\n.x { v: @less.ispercentage(@a); }\n`]
    ], async (root) => {
      const { js } = await built(root);
      const file = path.join(root, 'main.mjs');
      fs.writeFileSync(file, js);
      const module: unknown = await import(file);
      const vars = isRuntime(module) ? module.vars({ a: '20%' }) : {};
      expect(vars['--a']).toBe('0.2');
      expect(vars['--a-ispercentage']).toBe('true');
      expect(() => isRuntime(module) && module.vars({ a: '.2' })).toThrow('a is read by a CSS form in %');
    });
  });

  it('bundles no evaluator for rgb() over an exposed channel', async () => {
    await inProject([
      ['main.js', `export { vars } from './theme.less';\n`],
      ['theme.less', `@use "#less";\n@expose r;\n@r: 10;\n.a { color: @less.rgb(@r, 0, 0); }\n`]
    ], async (root) => {
      const { css, js } = await built(root);
      expect(css).toContain('rgb(var(--r, 10),0,0)');
      const file = path.join(root, 'main.mjs');
      fs.writeFileSync(file, js);
      const module: unknown = await import(file);
      expect(isRuntime(module) && module.vars({ r: '20' })['--r']).toBe('20');
      expect(() => isRuntime(module) && module.vars({ r: '20px' })).toThrow('in a number');

      /* The key map and the unit check: 906 B measured (736 B minified, 470 B gzip), 2,194 B with the number formatter. */
      expect(js.length).toBeLessThan(950);
    });
  });

  it('adds no function to the runtime of a page that prints only CSS forms', async () => {
    await inProject([
      ['main.js', `export { vars } from './theme.less';\n`],
      ['theme.less', `@use "#less";\n@expose brand;\n@brand: #c00;\n.a { color: @less.fade(@brand, 50%); background: @less.darken(@brand, 10%); }\n`]
    ], async (root) => {
      const { css, js } = await built(root);
      expect(css).toContain('rgb(from var(--brand, #c00) r g b / .5)');
      expect(js).not.toContain('--brand-');
      expect(js).not.toContain('hsl(from');

      /* Only `@jesscss/patch-css`'s key map, as nothing is computed: 381 B measured, 2,195 B with the unit check and the number formatter. */
      expect(js.length).toBeLessThan(400);
      const file = path.join(root, 'main.mjs');
      fs.writeFileSync(file, js);
      const module: unknown = await import(file);
      // eslint-disable-next-line @typescript-eslint/naming-convention -- custom property names
      expect(isRuntime(module) && module.vars({ brand: '#08f' })).toEqual({ '--brand': '#08f' });
    });
  });

  it('adds no JS to a page that exposes nothing and prints only CSS forms', async () => {
    await inProject([
      ['main.js', `import './theme.less';\nexport const size = 1;\n`],
      ['theme.less', `@use "#less";\n.a { color: @less.fade(var(--x), 50%); background: @less.darken(#c00, 10%); }\n`]
    ], async (root) => {
      const { css, js } = await built(root);
      expect(css).toContain('rgb(from var(--x) r g b / .5)');
      expect(js).not.toContain('createRuntime');
      expect(js).not.toContain('rgb(from');
    });
  });

  it('resolves a relative `@import` and `url()` from the stylesheet\'s directory', async () => {
    await inProject([
      ['main.js', `import './theme.less';\n`],
      ['theme.less', `@import url(./other.css);\n.a { background: url(./img.png); }\n`],
      ['other.css', `.other { color: red; }\n`],
      ['img.png', 'png']
    ], async (root) => {
      const { css } = await built(root);
      expect(css).toContain('.other');
      expect(css).toContain('url(data:image/png;base64,');
    });
  });

  it('keeps `a.module.less` and `a.module.jess` in one directory as two stylesheets', async () => {
    await inProject([
      ['main.js', `import less from './a.module.less';\nimport jess from './a.module.jess';\nexport { less, jess };\n`],
      ['a.module.less', `.fromless { color: red; }\n`],
      ['a.module.jess', `.fromjess { color: blue; }\n`]
    ], async (root) => {
      const { css } = await built(root);
      expect(css).toContain('fromless');
      expect(css).toContain('fromjess');
    });
  });

  it('compiles `?inline` with Jess, to the CSS as a string', async () => {
    await inProject([
      ['main.js', `export { default } from './theme.less?inline';\n`],
      ['theme.less', `@use "#less";\n.a { color: @less.darken(#c00, 10%); }\n`]
    ], async (root) => {
      const { css, js } = await built(root);
      expect(css).toBe('');
      expect(js).toContain('.a{color:#900}');
    });
  });

  it('serves the edited CSS of a stylesheet in dev', async () => {
    await inProject([
      ['theme.less', `.before { color: red; }\n`]
    ], async (root) => {
      const server = await createServer({ root, configFile: false, logLevel: 'silent', plugins: [jess()], server: { middlewareMode: true }, appType: 'custom' });
      try {
        await server.transformRequest('/theme.less');
        const css = async (): Promise<string> => (await server.transformRequest('/theme.less.css'))?.code ?? '';
        expect(await css()).toContain('.before');

        /* The dev server's watcher reports the edit; rewriting covers a watcher still starting up. */
        let edited = '';
        for (let tries = 0; tries < 50 && !edited.includes('.after'); tries++) {
          fs.writeFileSync(path.join(root, 'theme.less'), `.after { color: red; }\n`);
          await new Promise(resolve => setTimeout(resolve, 100));
          edited = await css();
        }
        expect(edited).toContain('.after');
        expect(edited).not.toContain('.before');
      } finally {
        await server.close();
      }
    });
  });

  it('scopes a `.module.less` through Vite\'s CSS Modules, the class map as its default export', async () => {
    const result = await build({
      root: __dirname,
      configFile: false,
      logLevel: 'silent',
      plugins: [jess()],
      build: { write: false, lib: { entry: path.resolve(__dirname, 'module.js'), formats: ['es'], fileName: 'module' } }
    });
    const first = [result].flat()[0];
    const output = first !== undefined && 'output' in first ? first.output : [];
    const css = output.find(item => item.type === 'asset' && item.fileName.endsWith('.css'));
    const text = css?.type === 'asset' ? String(css.source) : '';

    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vite-plugin-jess-'));
    try {
      const file = path.join(directory, 'module.mjs');
      fs.writeFileSync(file, output[0]?.code ?? '');
      const module: unknown = await import(file);
      expect(isModule(module)).toBe(true);
      if (isModule(module)) {
        expect(Object.keys(module.classes)).toEqual(['card', 'card__title']);
        expect(module.card).toBe(module.classes.card);
        expect(module.classes.card).not.toBe('card');
        expect(text).toContain(`.${module.classes.card}{color:var(--brand, #c00)}`);
        expect(text).toContain(`.${module.classes.card__title}{opacity:var(--brand-lightness, 40%)}`);
        expect(module.vars({ brand: '#08f' })['--brand-lightness']).toBe('50%');
      }
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});
