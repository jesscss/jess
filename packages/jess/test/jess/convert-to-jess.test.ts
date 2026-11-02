/**
 * `Compiler.convertToJess` points each converted import at the file the render
 * loaded. `.jess` imports name that file — no extension inference — so a Less
 * `@compose "b.less"` and an extension-less `@import "c"` both name the
 * converted sibling, and the `.jess` renders the CSS the `.less` does.
 */
import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Compiler } from '../../src/index.js';

/* Whether this file system matches names case-insensitively (macOS and Windows by default). */
const caseInsensitive = (() => {
  const probe = fs.mkdtempSync(path.join(os.tmpdir(), 'convert-to-jess-case-'));
  fs.writeFileSync(path.join(probe, 'a'), '');
  const insensitive = fs.existsSync(path.join(probe, 'A'));
  fs.rmSync(probe, { recursive: true, force: true });
  return insensitive;
})();

describe('Compiler.convertToJess', () => {
  let dir = '';
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('names the loaded file for a compose and an extension-less import', async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'convert-to-jess-'));
    fs.writeFileSync(path.join(dir, 'a.less'), '@compose "b.less";\n@import "c";\n.a { w: 1; }\n');
    fs.writeFileSync(path.join(dir, 'b.less'), '@b: red;\n.b { x: 1; }\n');
    fs.mkdirSync(path.join(dir, 'lib'));
    fs.writeFileSync(path.join(dir, 'c.less'), '@import "lib/d";\n.c { y: 2; }\n');
    fs.writeFileSync(path.join(dir, 'lib/d.less'), '.d { z: 3; }\n');

    const compiler = new Compiler();
    try {
      const { files, errors } = await compiler.convertToJess(path.join(dir, 'a.less'));
      expect(errors).toEqual([]);
      const printed = files.map(file => [path.relative(fs.realpathSync(dir), fs.realpathSync(file.source)), 'jess' in file ? file.jess : file.gaps]);
      expect(printed).toEqual([
        ['a.less', '@-compose "./b.jess";\n@-import "./c.jess";\n.a {\n  w: 1;\n}\n'],
        ['b.less', '$b: red;\n.b {\n  x: 1;\n}\n'],
        ['c.less', '@-import "./lib/d.jess";\n.c {\n  y: 2;\n}\n'],
        ['lib/d.less', '.d {\n  z: 3;\n}\n']
      ]);
      for (const file of files) {
        fs.writeFileSync(file.jessPath, 'jess' in file ? file.jess : '');
      }
      expect(await compiler.render(path.join(dir, 'a.jess'))).toBe(await compiler.render(path.join(dir, 'a.less')));
    } finally {
      compiler.dispose();
    }
  });

  /* An import the render left a CSS `@import` is written as authored, `url()` and all, not as a `.jess` import. */
  it('writes an import that stays CSS as authored', async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'convert-to-jess-'));
    fs.writeFileSync(path.join(dir, 'a.less'), '@import url("https://fonts.example/css?family=X");\n@import "theme.less";\n.a { w: 1; }\n');
    fs.writeFileSync(path.join(dir, 'theme.less'), '.t { x: 1; }\n');

    const UNPROCESSED = { language: { less: { processImports: false } } };
    const compiler = new Compiler();
    try {
      const plain = await compiler.convertToJess(path.join(dir, 'a.less'));
      expect(plain.errors).toEqual([]);
      expect(plain.files[0] && 'jess' in plain.files[0] ? plain.files[0].jess : plain.files[0])
        .toBe('@import url("https://fonts.example/css?family=X");\n@-import "./theme.jess";\n.a {\n  w: 1;\n}\n');

      /* `processImports: false` drops both imports from the CSS; `.jess` has no such policy to convert them to. */
      const unprocessed = await compiler.convertToJess(path.join(dir, 'a.less'), UNPROCESSED);
      expect(unprocessed.errors).toEqual([]);
      const [entry] = unprocessed.files;
      expect(entry && 'gaps' in entry ? entry.gaps.map(gap => gap.nodeType) : entry).toEqual(['StyleImport', 'StyleImport']);
    } finally {
      compiler.dispose();
    }
  });

  /* A `.jess` prelude takes CSS leaves or a whole `${name}`; a computed splice has no spelling there. */
  it('reports a computed splice in a prelude as a gap', async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'convert-to-jess-'));
    fs.writeFileSync(path.join(dir, 'a.scss'), '$tablet: 768px;\n.a {\n  @media (min-width: #{$tablet + 1px}) {\n    b: c;\n  }\n}\n');

    const compiler = new Compiler();
    try {
      const { files, errors } = await compiler.convertToJess(path.join(dir, 'a.scss'));
      expect(errors).toEqual([]);
      expect(files[0] && 'gaps' in files[0] ? files[0].gaps.map(gap => gap.nodeType) : files[0]).toEqual(['Interpolation']);
    } finally {
      compiler.dispose();
    }
  });

  /* Sass finds `@use "theme"` as `_theme.scss`; `.jess` names that file. */
  it('names the partial a Sass `@use` loaded', async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'convert-to-jess-'));
    fs.writeFileSync(path.join(dir, 'a.scss'), '@use "theme" as *;\n.x { @include scheme(dark) { b: c; } }\n');
    fs.writeFileSync(path.join(dir, '_theme.scss'), '@mixin scheme($name) {\n  @media (prefers-color-scheme: #{$name}) {\n    @content;\n  }\n}\n');

    const compiler = new Compiler();
    try {
      const { files, errors } = await compiler.convertToJess(path.join(dir, 'a.scss'));
      expect(errors).toEqual([]);
      const [entry, theme] = files;
      expect(entry && 'jess' in entry ? entry.jess : entry).toContain('@-compose "./_theme.jess" as *;');
      expect(theme && 'jess' in theme ? theme.jess : theme).toContain('@media (prefers-color-scheme: ${name}) {');
      for (const file of files) {
        fs.writeFileSync(file.jessPath, 'jess' in file ? file.jess : '');
      }
      const css = await compiler.render(path.join(dir, 'a.scss'));
      expect(css).toContain('@media (prefers-color-scheme: dark)');
      expect(await compiler.render(path.join(dir, 'a.jess'))).toBe(css);
    } finally {
      compiler.dispose();
    }
  });

  /* `b.less` and `b.scss` both convert to `b.jess`; `b.jess` holds only one of them, so an import of the other is a gap. */
  it('reports every import of a file whose `.jess` path another file takes', async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'convert-to-jess-'));
    fs.writeFileSync(path.join(dir, 'a.less'), '@import "b.less";\n@import "b.scss";\n@import "c";\n');
    fs.writeFileSync(path.join(dir, 'b.less'), '.b { x: 1; }\n');
    fs.writeFileSync(path.join(dir, 'b.scss'), '.s { y: 2; }\n');
    fs.writeFileSync(path.join(dir, 'c.less'), '@import "b.scss";\n');

    const compiler = new Compiler();
    try {
      const { files, errors } = await compiler.convertToJess(path.join(dir, 'a.less'));
      expect(errors).toEqual([]);
      const printed = files.map(file =>
        [path.relative(fs.realpathSync(dir), fs.realpathSync(file.source)), 'jess' in file ? file.jess : file.gaps.map(gap => gap.nodeType)]);
      expect(printed).toEqual([
        ['a.less', ['StyleImport']],
        ['b.less', '.b {\n  x: 1;\n}\n'],
        ['b.scss', ['Stylesheet']],
        ['c.less', ['StyleImport']]
      ]);
    } finally {
      compiler.dispose();
    }
  });

  /* A `.jess` file the render loaded is never a converted file's target: writing it would destroy what the render read. */
  it('reports a file whose `.jess` path is a file the render loaded', async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'convert-to-jess-'));
    fs.writeFileSync(path.join(dir, 'a.less'), '@import "b.less";\n@import "b.jess";\n.a{w:1}\n');
    fs.writeFileSync(path.join(dir, 'b.less'), '.b{x:1}\n');
    fs.writeFileSync(path.join(dir, 'b.jess'), '.authored-jess{y:2}\n');

    const compiler = new Compiler();
    try {
      const { files, errors } = await compiler.convertToJess(path.join(dir, 'a.less'));
      expect(errors).toEqual([]);
      const printed = files.map(file =>
        [path.relative(fs.realpathSync(dir), fs.realpathSync(file.source)), 'jess' in file ? file.jess : file.gaps.map(gap => gap.nodeType)]);
      expect(printed).toEqual([
        ['a.less', ['StyleImport']],
        ['b.less', ['Stylesheet']]
      ]);
    } finally {
      compiler.dispose();
    }
  });

  /*
   * The output prelude takes the CSS `@import`s of the entry and of every file it
   * imports (ledger N9); a `.jess` CSS `@import` is written where it stands, so
   * the entry's are written first, and an imported file's, or a Less import left
   * a CSS `@import` after a rule, is a gap.
   */
  it('writes the entry\'s prelude CSS imports first and reports the ones `.jess` cannot place', async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'convert-to-jess-'));
    fs.writeFileSync(path.join(dir, 'a.less'), '@import "t.less";\n@import "x.css";\n@import "x.css";\n.a { w: 1; }\n@import url("https://fonts.example/css");\n');
    fs.writeFileSync(path.join(dir, 't.less'), '@import "y.css";\n.t { x: 1; }\n');

    const compiler = new Compiler();
    try {
      const { files, errors } = await compiler.convertToJess(path.join(dir, 'a.less'));
      expect(errors).toEqual([]);
      expect(files.map(file => ('jess' in file ? file.jess : file.gaps.map(gap => gap.nodeType)))).toEqual([['StyleImport'], ['AtRuleStatement']]);

      fs.writeFileSync(path.join(dir, 'a.less'), '@import "theme.less";\n@import "x.css";\n@import "x.css";\n.a { w: 1; }\n');
      fs.writeFileSync(path.join(dir, 'theme.less'), '.t { x: 1; }\n');
      const converted = await compiler.convertToJess(path.join(dir, 'a.less'));
      const [entry] = converted.files;
      expect(entry && 'jess' in entry ? entry.jess : entry).toBe('@import "x.css";\n@-import "./theme.jess";\n.a {\n  w: 1;\n}\n');
    } finally {
      compiler.dispose();
    }
  });

  /*
   * Ledger A19: a conversion whose render reaches a stylesheet script runs whole
   * in the sandbox, as `safeRender` does: the script reports where it ran.
   */
  it('converts in the sandbox once the render reaches a script', async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'convert-to-jess-'));
    fs.writeFileSync(path.join(dir, 'p.js'), `module.exports = { install(less, pm, functions) {
  functions.add('where', () => { throw new Error('in the engine: ' + String(globalThis[Symbol.for('@jesscss/plugin-js/engine')] === true)); });
} };\n`);
    fs.writeFileSync(path.join(dir, 'a.less'), '@plugin "./p.js";\n.a { w: where(); }\n');

    const compiler = new Compiler();
    try {
      const { files, errors, warnings } = await compiler.convertToJess(path.join(dir, 'a.less'));
      expect(errors).toEqual([]);
      expect(warnings.map(warning => warning.reason).join('\n')).toContain('in the engine: true');
      expect(files.map(file => file.jessPath)).toEqual([path.join(dir, 'a.jess')]);
    } finally {
      compiler.dispose();
    }
  }, 60_000);

  /*
   * A `.jess` path that already exists is never written without `overwrite`,
   * and never, even with it, when it is a symlink or a file the render loaded,
   * however the import spells it. The file that cannot be written, and its
   * importer, are gaps.
   */
  describe('an existing `.jess` path', () => {
    const convert = async (overwrite: boolean) => {
      const compiler = new Compiler();
      try {
        const { files, errors } = await compiler.convertToJess(path.join(dir, 'a.less'), undefined, { overwrite });
        expect(errors).toEqual([]);
        return Object.fromEntries(files.map(file => [path.basename(file.source), 'jess' in file ? 'jess' : file.gaps.map(gap => gap.reason).join(' | ')]));
      } finally {
        compiler.dispose();
      }
    };
    const setUp = (entry: string, more: (at: string) => void) => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), 'convert-to-jess-'));
      fs.writeFileSync(path.join(dir, 'a.less'), entry);
      fs.writeFileSync(path.join(dir, 'b.less'), '.b{x:1}\n');
      more(dir);
    };

    it.runIf(caseInsensitive)('is a gap when the render loaded it under another case', async () => {
      setUp('@import "b.less";\n@import "B.jess";\n.a{w:1}\n', at => fs.writeFileSync(path.join(at, 'b.jess'), '.authored-jess{y:2}\n'));
      expect((await convert(false))['b.less']).toContain('would overwrite an existing file');
      expect((await convert(true))['b.less']).toContain('is a file this render loaded');
      expect(fs.readFileSync(path.join(dir, 'b.jess'), 'utf8')).toBe('.authored-jess{y:2}\n');
    });

    it('is a gap when the render loaded it through a folder alias', async () => {
      setUp('@import "b.less";\n@import "alias/b.jess";\n.a{w:1}\n', (at) => {
        fs.writeFileSync(path.join(at, 'b.jess'), '.authored-jess{y:2}\n');
        fs.symlinkSync('.', path.join(at, 'alias'), 'dir');
      });
      expect((await convert(false))['b.less']).toContain('would overwrite an existing file');
      expect((await convert(true))['b.less']).toContain('is a file this render loaded');
    });

    it('is a gap when it is a symlink to a file the render loaded', async () => {
      setUp('@import "b.less";\n@import "real.jess";\n.a{w:1}\n', (at) => {
        fs.writeFileSync(path.join(at, 'real.jess'), '.authored-jess{y:2}\n');
        fs.symlinkSync('real.jess', path.join(at, 'b.jess'));
      });
      expect((await convert(false))['b.less']).toContain('is a symlink');
      expect((await convert(true))['b.less']).toContain('is a symlink');
    });

    /* Under pnpm a `node_modules/.pnpm` file is a hard link into the global store: writing it would change every project's copy. */
    it('is a gap, even with `overwrite`, when it is hard-linked', async () => {
      setUp('@import "b.less";\n.a{w:1}\n', (at) => {
        fs.writeFileSync(path.join(at, 'store.jess'), '.shared{y:2}\n');
        fs.linkSync(path.join(at, 'store.jess'), path.join(at, 'b.jess'));
      });
      expect((await convert(true))['b.less']).toContain('is a hard-linked file');
      expect(fs.readFileSync(path.join(dir, 'store.jess'), 'utf8')).toBe('.shared{y:2}\n');
    });

    it('is a gap unless `overwrite` is set when the render did not load it', async () => {
      setUp('@import "b.less";\n.a{w:1}\n', at => fs.writeFileSync(path.join(at, 'b.jess'), '.stale{y:2}\n'));
      const kept = await convert(false);
      expect(kept['a.less']).toContain('cannot be written');
      expect(kept['b.less']).toContain('would overwrite an existing file');
      const replaced = await convert(true);
      expect([replaced['a.less'], replaced['b.less']]).toEqual(['jess', 'jess']);
    });
  });

  /*
   * A partial reached through a symlink keeps the path the render spelled on
   * both routes, so the converted importer's `@-import` names the file written.
   */
  it('names a symlinked partial the same way in the sandbox as in this process', async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'convert-to-jess-'));
    fs.mkdirSync(path.join(dir, 'real'));
    fs.writeFileSync(path.join(dir, 'real', 'in.less'), '.r { x: 1; }\n');
    fs.symlinkSync(path.join('real', 'in.less'), path.join(dir, 'in-link.less'));
    fs.writeFileSync(path.join(dir, 'm.js'), 'export const dbl = (n) => n;\n');
    fs.writeFileSync(path.join(dir, 'here.less'), '@import "in-link.less";\n.a { w: 1; }\n');
    fs.writeFileSync(path.join(dir, 's2.less'), '@-use "./m.js";\n@import "in-link.less";\n.a { w: 1; }\n');

    const compiler = new Compiler();
    try {
      const partial = async (entry: string) => {
        const { files, errors } = await compiler.convertToJess(path.join(dir, entry), { suppressWarnings: true });
        expect(errors).toEqual([]);
        return files.find(file => path.basename(file.source) === 'in-link.less');
      };
      const here = await partial('here.less');
      const sandboxed = await partial('s2.less');
      expect(here).toEqual({ source: path.join(dir, 'in-link.less'), jessPath: path.join(dir, 'in-link.jess'), jess: '.r {\n  x: 1;\n}\n' });
      expect(sandboxed).toEqual(here);

      const { files } = await compiler.convertToJess(path.join(dir, 's2.less'), { suppressWarnings: true });
      for (const file of files) {
        fs.writeFileSync(file.jessPath, 'jess' in file ? file.jess : '', { flag: 'wx' });
      }
      const css = await compiler.render(path.join(dir, 's2.less'), { suppressWarnings: true });
      expect(css).toContain('.r {');
      expect(await compiler.render(path.join(dir, 's2.jess'), { suppressWarnings: true })).toBe(css);
    } finally {
      compiler.dispose();
    }
  }, 60_000);
});
